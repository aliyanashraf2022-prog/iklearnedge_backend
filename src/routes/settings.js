const express = require('express');
const { query } = require('../models/database');

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

module.exports = router;
