const express = require('express');
const { query } = require('../models/database');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/settings
// @desc    Get public site settings
// @access  Public
router.get('/', async (req, res) => {
  try {
    const result = await query('SELECT * FROM site_settings ORDER BY setting_key');
    
    const settings = {};
    result.rows.forEach(row => {
      if (row.setting_type === 'number') {
        settings[row.setting_key] = parseFloat(row.setting_value);
      } else if (row.setting_type === 'boolean') {
        settings[row.setting_key] = row.setting_value === 'true';
      } else {
        settings[row.setting_key] = row.setting_value;
      }
    });

    res.json({
      success: true,
      data: settings
    });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get settings'
    });
  }
});

// @route   GET /api/settings/bank-details
// @desc    Get bank transfer details
// @access  Public (shown to students)
router.get('/bank-details', async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM bank_details WHERE is_active = true ORDER BY created_at DESC LIMIT 1`
    );

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        data: {
          bankName: 'Dubai Islamic Bank',
          accountNumber: '1234567890',
          iban: 'AE123456789012345678901',
          accountHolderName: 'IkLearnEdge',
          swiftCode: 'DIB AEA S',
          branchAddress: 'Dubai, UAE'
        }
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Get bank details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get bank details'
    });
  }
});

// @route   PUT /api/settings/bank-details
// @desc    Update bank transfer details
// @access  Private/Admin
router.put('/bank-details', authenticate, requireAdmin, async (req, res) => {
  try {
    const { bankName, accountNumber, iban, accountHolderName, swiftCode, branchAddress } = req.body;

    // Check if bank details exist
    const existing = await query('SELECT id FROM bank_details LIMIT 1');
    
    if (existing.rows.length > 0) {
      // Update existing
      await query(
        `UPDATE bank_details SET 
          bank_name = $1, 
          account_number = $2, 
          iban = $3, 
          account_holder_name = $4, 
          swift_code = $5, 
          branch_address = $6,
          updated_at = NOW()
         WHERE id = $7`,
        [bankName, accountNumber, iban, accountHolderName, swiftCode, branchAddress, existing.rows[0].id]
      );
    } else {
      // Insert new
      await query(
        `INSERT INTO bank_details (bank_name, account_number, iban, account_holder_name, swift_code, branch_address)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [bankName, accountNumber, iban, accountHolderName, swiftCode, branchAddress]
      );
    }

    res.json({
      success: true,
      message: 'Bank details updated successfully'
    });
  } catch (error) {
    console.error('Update bank details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update bank details'
    });
  }
});

module.exports = router;
