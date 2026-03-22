const express = require('express');
const { query, tableExists } = require('../models/database');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

const BANK_SETTING_KEYS = Object.freeze({
  bankName: 'bank_name',
  accountNumber: 'bank_account_number',
  iban: 'bank_iban',
  accountHolderName: 'bank_account_holder_name',
  swiftCode: 'bank_swift_code',
  branchAddress: 'bank_branch_address',
  isActive: 'bank_is_active',
});

const EMPTY_BANK_DETAILS = Object.freeze({
  bankName: '',
  accountNumber: '',
  iban: '',
  accountHolderName: '',
  swiftCode: '',
  branchAddress: '',
  isActive: true,
});

const toSettingsObject = (rows) => {
  const settings = {};

  rows.forEach((row) => {
    if (row.setting_type === 'number') {
      settings[row.setting_key] = Number(row.setting_value);
    } else if (row.setting_type === 'boolean') {
      settings[row.setting_key] = row.setting_value === 'true';
    } else {
      settings[row.setting_key] = row.setting_value;
    }
  });

  return settings;
};

const toBankDetails = (row) => ({
  id: row.id,
  bankName: row.bank_name,
  accountNumber: row.account_number,
  iban: row.iban,
  accountHolderName: row.account_holder_name,
  swiftCode: row.swift_code,
  branchAddress: row.branch_address,
  isActive: row.is_active,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toBankDetailsFromSettings = (rows) => {
  const lookup = rows.reduce((accumulator, row) => ({
    ...accumulator,
    [row.setting_key]: row.setting_value,
  }), {});

  return {
    ...EMPTY_BANK_DETAILS,
    bankName: lookup[BANK_SETTING_KEYS.bankName] || '',
    accountNumber: lookup[BANK_SETTING_KEYS.accountNumber] || '',
    iban: lookup[BANK_SETTING_KEYS.iban] || '',
    accountHolderName: lookup[BANK_SETTING_KEYS.accountHolderName] || '',
    swiftCode: lookup[BANK_SETTING_KEYS.swiftCode] || '',
    branchAddress: lookup[BANK_SETTING_KEYS.branchAddress] || '',
    isActive: lookup[BANK_SETTING_KEYS.isActive]
      ? lookup[BANK_SETTING_KEYS.isActive] === 'true'
      : true,
  };
};

const getBankDetailsFromSettings = async () => {
  const result = await query(
    `SELECT setting_key, setting_value
     FROM site_settings
     WHERE setting_key = ANY($1::text[])`,
    [Object.values(BANK_SETTING_KEYS)],
  );

  return toBankDetailsFromSettings(result.rows);
};

const upsertSiteSetting = async (settingKey, settingValue, settingType) => {
  await query(
    `INSERT INTO site_settings (setting_key, setting_value, setting_type, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (setting_key)
     DO UPDATE SET
       setting_value = EXCLUDED.setting_value,
       setting_type = EXCLUDED.setting_type,
       updated_at = NOW()`,
    [settingKey, settingValue, settingType],
  );
};

const hasBankDetailsTable = async () => {
  try {
    return await tableExists('bank_details');
  } catch (error) {
    console.error('Check bank details table error:', error);
    return false;
  }
};

router.get('/', async (req, res) => {
  try {
    const result = await query('SELECT * FROM site_settings ORDER BY setting_key');

    return res.json({
      success: true,
      data: toSettingsObject(result.rows),
    });
  } catch (error) {
    console.error('Get settings error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get settings',
    });
  }
});

router.get('/bank-details', async (req, res) => {
  try {
    const useBankTable = await hasBankDetailsTable();

    if (!useBankTable) {
      return res.json({
        success: true,
        data: await getBankDetailsFromSettings(),
      });
    }

    const result = await query(
      `SELECT *
       FROM bank_details
       WHERE is_active = true
       ORDER BY created_at DESC
       LIMIT 1`,
    );

    if (!result.rows.length) {
      return res.json({
        success: true,
        data: await getBankDetailsFromSettings(),
      });
    }

    return res.json({
      success: true,
      data: toBankDetails(result.rows[0]),
    });
  } catch (error) {
    console.error('Get bank details error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get bank details',
    });
  }
});

router.put('/bank-details', authenticate, requireAdmin, async (req, res) => {
  try {
    const {
      bankName,
      accountNumber,
      iban,
      accountHolderName,
      swiftCode,
      branchAddress,
    } = req.body;

    const useBankTable = await hasBankDetailsTable();
    let bankDetails = null;

    if (useBankTable) {
      const existing = await query(
        'SELECT id FROM bank_details WHERE is_active = true ORDER BY created_at DESC LIMIT 1',
      );

      if (existing.rows.length) {
        await query(
          `UPDATE bank_details
           SET bank_name = $1,
               account_number = $2,
               iban = $3,
               account_holder_name = $4,
               swift_code = $5,
               branch_address = $6,
               updated_at = NOW()
           WHERE id = $7`,
          [
            bankName,
            accountNumber,
            iban,
            accountHolderName,
            swiftCode,
            branchAddress,
            existing.rows[0].id,
          ],
        );
      } else {
        await query(
          `INSERT INTO bank_details (
            bank_name,
            account_number,
            iban,
            account_holder_name,
            swift_code,
            branch_address,
            is_active
          ) VALUES ($1, $2, $3, $4, $5, $6, true)`,
          [
            bankName,
            accountNumber,
            iban,
            accountHolderName,
            swiftCode,
            branchAddress,
          ],
        );
      }

      const updated = await query(
        `SELECT *
         FROM bank_details
         WHERE is_active = true
         ORDER BY created_at DESC
         LIMIT 1`,
      );

      bankDetails = updated.rows.length
        ? toBankDetails(updated.rows[0])
        : EMPTY_BANK_DETAILS;
    } else {
      await Promise.all([
        upsertSiteSetting(BANK_SETTING_KEYS.bankName, bankName || '', 'string'),
        upsertSiteSetting(BANK_SETTING_KEYS.accountNumber, accountNumber || '', 'string'),
        upsertSiteSetting(BANK_SETTING_KEYS.iban, iban || '', 'string'),
        upsertSiteSetting(BANK_SETTING_KEYS.accountHolderName, accountHolderName || '', 'string'),
        upsertSiteSetting(BANK_SETTING_KEYS.swiftCode, swiftCode || '', 'string'),
        upsertSiteSetting(BANK_SETTING_KEYS.branchAddress, branchAddress || '', 'string'),
        upsertSiteSetting(BANK_SETTING_KEYS.isActive, 'true', 'boolean'),
      ]);

      bankDetails = await getBankDetailsFromSettings();
    }

    return res.json({
      success: true,
      message: 'Bank details updated successfully',
      data: bankDetails,
    });
  } catch (error) {
    console.error('Update bank details error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update bank details',
    });
  }
});

module.exports = router;
