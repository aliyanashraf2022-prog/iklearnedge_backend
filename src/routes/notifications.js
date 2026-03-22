const express = require('express');
const { query } = require('../models/database');
const { authenticate } = require('../middleware/auth');
const { normalizeNotificationType } = require('../utils/workflow');

const router = express.Router();

// @route   GET /api/notifications
// @desc    Get user notifications
// @access  Private
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await query(`
      SELECT * FROM notifications 
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 50
    `, [userId]);

    res.json({
      success: true,
      count: result.rows.length,
      unread: result.rows.filter(n => !n.is_read).length,
      data: result.rows
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get notifications'
    });
  }
});

// @route   GET /api/notifications/unread/count
// @desc    Get unread notification count
// @access  Private
router.get('/unread/count', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await query(`
      SELECT COUNT(*) as count FROM notifications 
      WHERE user_id = $1 AND is_read = false
    `, [userId]);

    res.json({
      success: true,
      count: parseInt(result.rows[0].count) || 0
    });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get unread count'
    });
  }
});

// @route   PUT /api/notifications/:id/read
// @desc    Mark notification as read
// @access  Private
router.put('/:id/read', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    await query(`
      UPDATE notifications 
      SET is_read = true
      WHERE id = $1 AND user_id = $2
    `, [id, userId]);

    res.json({
      success: true,
      message: 'Notification marked as read'
    });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark notification as read'
    });
  }
});

// @route   PUT /api/notifications/read/all
// @desc    Mark all notifications as read
// @access  Private
router.put('/read/all', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    await query(`
      UPDATE notifications 
      SET is_read = true
      WHERE user_id = $1 AND is_read = false
    `, [userId]);

    res.json({
      success: true,
      message: 'All notifications marked as read'
    });
  } catch (error) {
    console.error('Mark all read error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark notifications as read'
    });
  }
});

// @route   DELETE /api/notifications/:id
// @desc    Delete a notification
// @access  Private
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    await query('DELETE FROM notifications WHERE id = $1 AND user_id = $2', [id, userId]);

    res.json({
      success: true,
      message: 'Notification deleted'
    });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete notification'
    });
  }
});

// @route   POST /api/notifications
// @desc    Create a notification (internal use)
// @access  Private
router.post('/', authenticate, async (req, res) => {
  try {
    const { userId, title, message, type } = req.body;

    const result = await query(`
      INSERT INTO notifications (user_id, title, message, type)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [userId, title, message, normalizeNotificationType(type)]);

    res.status(201).json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Create notification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create notification'
    });
  }
});

// Helper function to create notifications for specific events
const createNotification = async (userId, title, message, type) => {
  try {
    await query(`
      INSERT INTO notifications (user_id, title, message, type)
      VALUES ($1, $2, $3, $4)
    `, [userId, title, message, normalizeNotificationType(type)]);
  } catch (error) {
    console.error('Auto notification error:', error);
  }
};

// Export for use in other routes
module.exports = router;
module.exports.createNotification = createNotification;
