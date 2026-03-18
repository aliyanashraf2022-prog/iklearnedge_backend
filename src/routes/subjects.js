const express = require('express');
const { body, validationResult } = require('express-validator');
const { query, transaction } = require('../models/database');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/subjects
// @desc    Get all active subjects with pricing
// @access  Public
router.get('/', async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        s.id, s.name, s.description, s.image, s.is_active,
        COUNT(DISTINCT ts.teacher_id) as tutor_count
      FROM subjects s
      LEFT JOIN teacher_subjects ts ON s.id = ts.subject_id
      WHERE s.is_active = true
      GROUP BY s.id
      ORDER BY s.name
    `);

    // Get pricing tiers for each subject
    const subjectsWithPricing = await Promise.all(
      result.rows.map(async (subject) => {
        const pricingResult = await query(
          'SELECT id, grade_level, price_per_hour FROM pricing_tiers WHERE subject_id = $1 ORDER BY grade_level',
          [subject.id]
        );
        return {
          ...subject,
          pricingTiers: pricingResult.rows
        };
      })
    );

    res.json({
      success: true,
      data: subjectsWithPricing
    });
  } catch (error) {
    console.error('Get subjects error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get subjects'
    });
  }
});

// @route   GET /api/subjects/all
// @desc    Get all subjects (including inactive) - Admin only
// @access  Private/Admin
router.get('/all', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        s.id, s.name, s.description, s.image, s.is_active,
        COUNT(DISTINCT ts.teacher_id) as tutor_count
      FROM subjects s
      LEFT JOIN teacher_subjects ts ON s.id = ts.subject_id
      GROUP BY s.id
      ORDER BY s.name
    `);

    // Get pricing tiers for each subject
    const subjectsWithPricing = await Promise.all(
      result.rows.map(async (subject) => {
        const pricingResult = await query(
          'SELECT id, grade_level, price_per_hour FROM pricing_tiers WHERE subject_id = $1 ORDER BY grade_level',
          [subject.id]
        );
        return {
          ...subject,
          pricingTiers: pricingResult.rows
        };
      })
    );

    res.json({
      success: true,
      data: subjectsWithPricing
    });
  } catch (error) {
    console.error('Get all subjects error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get subjects'
    });
  }
});

// @route   GET /api/subjects/:id
// @desc    Get single subject with pricing
// @access  Public
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const subjectResult = await query(`
      SELECT 
        s.id, s.name, s.description, s.image, s.is_active,
        COUNT(DISTINCT ts.teacher_id) as tutor_count
      FROM subjects s
      LEFT JOIN teacher_subjects ts ON s.id = ts.subject_id
      WHERE s.id = $1
      GROUP BY s.id
    `, [id]);

    if (subjectResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Subject not found'
      });
    }

    const pricingResult = await query(
      'SELECT id, grade_level, price_per_hour FROM pricing_tiers WHERE subject_id = $1 ORDER BY grade_level',
      [id]
    );

    res.json({
      success: true,
      data: {
        ...subjectResult.rows[0],
        pricingTiers: pricingResult.rows
      }
    });
  } catch (error) {
    console.error('Get subject error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get subject'
    });
  }
});

// @route   GET /api/subjects/:id/price
// @desc    Get price for subject and grade level
// @access  Public
router.get('/:id/price', async (req, res) => {
  try {
    const { id } = req.params;
    const { gradeLevel } = req.query;

    if (!gradeLevel) {
      return res.status(400).json({
        success: false,
        message: 'Grade level is required'
      });
    }

    const result = await query(
      'SELECT price_per_hour FROM pricing_tiers WHERE subject_id = $1 AND grade_level = $2',
      [id, gradeLevel]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Price not found for this subject and grade level'
      });
    }

    res.json({
      success: true,
      data: {
        pricePerHour: result.rows[0].price_per_hour
      }
    });
  } catch (error) {
    console.error('Get price error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get price'
    });
  }
});

// @route   POST /api/subjects
// @desc    Create new subject with pricing - Admin only
// @access  Private/Admin
router.post('/', authenticate, requireAdmin, [
  body('name').trim().isLength({ min: 2 }),
  body('description').optional().trim(),
  body('pricingTiers').isArray({ min: 1 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { name, description, image, pricingTiers } = req.body;

    const result = await transaction(async (client) => {
      // Create subject
      const subjectResult = await client.query(
        `INSERT INTO subjects (name, description, image, is_active)
         VALUES ($1, $2, $3, true)
         RETURNING *`,
        [name, description || '', image || '/subject-default.jpg']
      );

      const subject = subjectResult.rows[0];

      // Create pricing tiers
      for (const tier of pricingTiers) {
        await client.query(
          `INSERT INTO pricing_tiers (subject_id, grade_level, price_per_hour)
           VALUES ($1, $2, $3)`,
          [subject.id, tier.gradeLevel, tier.pricePerHour]
        );
      }

      return subject;
    });

    res.status(201).json({
      success: true,
      message: 'Subject created successfully',
      data: result
    });
  } catch (error) {
    console.error('Create subject error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create subject'
    });
  }
});

// @route   PUT /api/subjects/:id
// @desc    Update subject - Admin only
// @access  Private/Admin
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, image, isActive } = req.body;

    const updates = [];
    const values = [];
    let paramCount = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramCount}`);
      values.push(name);
      paramCount++;
    }

    if (description !== undefined) {
      updates.push(`description = $${paramCount}`);
      values.push(description);
      paramCount++;
    }

    if (image !== undefined) {
      updates.push(`image = $${paramCount}`);
      values.push(image);
      paramCount++;
    }

    if (isActive !== undefined) {
      updates.push(`is_active = $${paramCount}`);
      values.push(isActive);
      paramCount++;
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }

    values.push(id);

    const result = await query(
      `UPDATE subjects SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${paramCount}
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Subject not found'
      });
    }

    res.json({
      success: true,
      message: 'Subject updated successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Update subject error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update subject'
    });
  }
});

// @route   PUT /api/subjects/:id/pricing
// @desc    Update pricing tiers for a subject - Admin only
// @access  Private/Admin
router.put('/:id/pricing', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { pricingTiers } = req.body;

    if (!pricingTiers || !Array.isArray(pricingTiers)) {
      return res.status(400).json({
        success: false,
        message: 'Pricing tiers array is required'
      });
    }

    await transaction(async (client) => {
      // Delete existing pricing tiers
      await client.query(
        'DELETE FROM pricing_tiers WHERE subject_id = $1',
        [id]
      );

      // Insert new pricing tiers
      for (const tier of pricingTiers) {
        await client.query(
          `INSERT INTO pricing_tiers (subject_id, grade_level, price_per_hour)
           VALUES ($1, $2, $3)`,
          [id, tier.gradeLevel, tier.pricePerHour]
        );
      }
    });

    // Get updated pricing
    const pricingResult = await query(
      'SELECT id, grade_level, price_per_hour FROM pricing_tiers WHERE subject_id = $1 ORDER BY grade_level',
      [id]
    );

    res.json({
      success: true,
      message: 'Pricing updated successfully',
      data: pricingResult.rows
    });
  } catch (error) {
    console.error('Update pricing error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update pricing'
    });
  }
});

// @route   DELETE /api/subjects/:id
// @desc    Delete subject (soft delete by setting inactive) - Admin only
// @access  Private/Admin
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Soft delete - set inactive instead of actually deleting
    const result = await query(
      `UPDATE subjects SET is_active = false, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Subject not found'
      });
    }

    res.json({
      success: true,
      message: 'Subject deactivated successfully'
    });
  } catch (error) {
    console.error('Delete subject error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete subject'
    });
  }
});

module.exports = router;
