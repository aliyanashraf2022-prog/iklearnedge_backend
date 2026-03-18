const express = require('express');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { authenticate } = require('../middleware/auth');
const { query } = require('../models/database');

const router = express.Router();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configure multer for memory storage
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept images and PDFs
    const allowedMimes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, and PDF are allowed.'), false);
    }
  }
});

// @route   POST /api/upload/profile-picture
// @desc    Upload profile picture
// @access  Private
router.post('/profile-picture', authenticate, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    // Convert buffer to base64
    const base64String = req.file.buffer.toString('base64');
    const dataUri = `data:${req.file.mimetype};base64,${base64String}`;

    // Upload to Cloudinary
    const result = await cloudinary.uploader.upload(dataUri, {
      folder: 'iklearnedge/profiles',
      public_id: `user_${req.user.id}_${Date.now()}`,
      transformation: [
        { width: 400, height: 400, crop: 'fill' },
        { quality: 'auto' }
      ]
    });

    // Update user's profile picture in database
    await query(
      'UPDATE users SET profile_picture = $1, updated_at = NOW() WHERE id = $2',
      [result.secure_url, req.user.id]
    );

    res.json({
      success: true,
      message: 'Profile picture uploaded successfully',
      data: {
        url: result.secure_url
      }
    });
  } catch (error) {
    console.error('Upload profile picture error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload profile picture'
    });
  }
});

// @route   POST /api/upload/document
// @desc    Upload teacher document (degree, certificate, ID)
// @access  Private/Teacher
router.post('/document', authenticate, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const { type } = req.body; // 'degree', 'certificate', 'identity'

    if (!['degree', 'certificate', 'identity'].includes(type)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid document type'
      });
    }

    // Get teacher ID
    const teacherResult = await query(
      'SELECT id FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    if (teacherResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Teacher not found'
      });
    }

    const teacherId = teacherResult.rows[0].id;

    // Convert buffer to base64
    const base64String = req.file.buffer.toString('base64');
    const dataUri = `data:${req.file.mimetype};base64,${base64String}`;

    // Upload to Cloudinary
    const result = await cloudinary.uploader.upload(dataUri, {
      folder: `iklearnedge/documents/${type}`,
      public_id: `teacher_${teacherId}_${type}_${Date.now()}`,
      resource_type: 'auto'
    });

    // Save document reference in database
    const docResult = await query(
      `INSERT INTO documents (teacher_id, type, file_url, file_name)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [teacherId, type, result.secure_url, req.file.originalname]
    );

    res.json({
      success: true,
      message: 'Document uploaded successfully',
      data: docResult.rows[0]
    });
  } catch (error) {
    console.error('Upload document error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload document'
    });
  }
});

// @route   POST /api/upload/payment-proof
// @desc    Upload payment proof
// @access  Private/Student
router.post('/payment-proof', authenticate, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const { bookingId } = req.body;

    if (!bookingId) {
      return res.status(400).json({
        success: false,
        message: 'Booking ID is required'
      });
    }

    // Verify booking belongs to student
    const studentResult = await query(
      'SELECT id FROM students WHERE user_id = $1',
      [req.user.id]
    );
    const studentId = studentResult.rows[0].id;

    const bookingResult = await query(
      'SELECT id FROM bookings WHERE id = $1 AND student_id = $2',
      [bookingId, studentId]
    );

    if (bookingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Convert buffer to base64
    const base64String = req.file.buffer.toString('base64');
    const dataUri = `data:${req.file.mimetype};base64,${base64String}`;

    // Upload to Cloudinary
    const result = await cloudinary.uploader.upload(dataUri, {
      folder: 'iklearnedge/payments',
      public_id: `payment_${bookingId}_${Date.now()}`,
      resource_type: 'auto'
    });

    res.json({
      success: true,
      message: 'Payment proof uploaded successfully',
      data: {
        url: result.secure_url,
        publicId: result.public_id
      }
    });
  } catch (error) {
    console.error('Upload payment proof error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload payment proof'
    });
  }
});

// @route   DELETE /api/upload/:publicId
// @desc    Delete uploaded file
// @access  Private
router.delete('/:publicId', authenticate, async (req, res) => {
  try {
    const { publicId } = req.params;

    // Delete from Cloudinary
    await cloudinary.uploader.destroy(publicId);

    res.json({
      success: true,
      message: 'File deleted successfully'
    });
  } catch (error) {
    console.error('Delete file error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete file'
    });
  }
});

module.exports = router;
