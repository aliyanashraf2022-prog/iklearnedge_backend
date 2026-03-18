const jwt = require('jsonwebtoken');
const { query } = require('../models/database');

// Verify JWT token
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.'
      });
    }

    const token = authHeader.split(' ')[1];
    
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Get user from database
    const result = await query(
      'SELECT id, email, name, role, profile_picture FROM users WHERE id = $1',
      [decoded.userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }
    
    req.user = result.rows[0];
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired'
      });
    }
    console.error('Auth middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Authentication error'
    });
  }
};

// Check if user is admin
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin only.'
    });
  }
  next();
};

// Check if user is teacher
const requireTeacher = (req, res, next) => {
  if (req.user.role !== 'teacher') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Teacher only.'
    });
  }
  next();
};

// Check if user is student
const requireStudent = (req, res, next) => {
  if (req.user.role !== 'student') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Student only.'
    });
  }
  next();
};

// Check if user is teacher or admin
const requireTeacherOrAdmin = (req, res, next) => {
  if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Teacher or Admin only.'
    });
  }
  next();
};

// Check if user owns the resource or is admin
const requireOwnerOrAdmin = (paramName = 'userId') => {
  return (req, res, next) => {
    const resourceUserId = req.params[paramName] || req.body.userId;
    if (req.user.role !== 'admin' && req.user.id !== resourceUserId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Not authorized.'
      });
    }
    next();
  };
};

module.exports = {
  authenticate,
  requireAdmin,
  requireTeacher,
  requireStudent,
  requireTeacherOrAdmin,
  requireOwnerOrAdmin
};
