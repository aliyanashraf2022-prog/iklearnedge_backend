const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { query, transaction } = require('../models/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const generateToken = (userId, role) => jwt.sign(
  { userId, role },
  process.env.JWT_SECRET,
  { expiresIn: process.env.JWT_EXPIRE || '7d' },
);

const validate = (rules) => [
  ...rules,
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array(),
      });
    }
    return next();
  },
];

const toUserPayload = (user) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  profilePicture: user.profilePicture || user.profile_picture || null,
});

router.post(
  '/register',
  validate([
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 6 }),
    body('name').trim().isLength({ min: 2 }),
    body('role').isIn(['teacher', 'student']),
    body('subjects').optional().isArray(),
  ]),
  async (req, res) => {
    try {
      const {
        email,
        password,
        name,
        role,
        gradeLevel,
        bio,
        subjects = [],
      } = req.body;

      const existingUser = await query(
        'SELECT id FROM users WHERE email = $1',
        [email],
      );

      if (existingUser.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'User already exists with this email',
        });
      }

      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(password, salt);

      const user = await transaction(async (client) => {
        const userResult = await client.query(
          `INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, $2, $3, $4)
           RETURNING
             id,
             email,
             name,
             role,
             profile_picture AS "profilePicture",
             created_at AS "createdAt"`,
          [email, passwordHash, name, role],
        );

        const createdUser = userResult.rows[0];

        if (role === 'teacher') {
          const teacherResult = await client.query(
            `INSERT INTO teachers (user_id, bio, verification_status, is_live)
             VALUES ($1, $2, 'pending', false)
             RETURNING id`,
            [createdUser.id, bio || ''],
          );

          const teacherId = teacherResult.rows[0].id;

          for (const subjectId of subjects) {
            await client.query(
              `INSERT INTO teacher_subjects (teacher_id, subject_id)
               VALUES ($1, $2)`,
              [teacherId, subjectId],
            );
          }
        }

        if (role === 'student') {
          await client.query(
            `INSERT INTO students (user_id, grade_level)
             VALUES ($1, $2)`,
            [createdUser.id, gradeLevel || ''],
          );
        }

        return createdUser;
      });

      const token = generateToken(user.id, user.role);

      return res.status(201).json({
        success: true,
        message: 'User registered successfully',
        data: {
          user: toUserPayload(user),
          token,
        },
      });
    } catch (error) {
      console.error('Registration error:', error);
      return res.status(500).json({
        success: false,
        message: 'Registration failed',
      });
    }
  },
);

router.post(
  '/login',
  validate([
    body('email').isEmail().normalizeEmail(),
    body('password').exists(),
  ]),
  async (req, res) => {
    try {
      const { email, password } = req.body;
      const result = await query(
        `SELECT
           id,
           email,
           name,
           role,
           profile_picture AS "profilePicture",
           password_hash AS "passwordHash"
         FROM users
         WHERE email = $1`,
        [email],
      );

      if (result.rows.length === 0) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password',
        });
      }

      const user = result.rows[0];
      const isMatch = await bcrypt.compare(password, user.passwordHash);

      if (!isMatch) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password',
        });
      }

      const token = generateToken(user.id, user.role);

      return res.json({
        success: true,
        message: 'Login successful',
        data: {
          user: toUserPayload(user),
          token,
        },
      });
    } catch (error) {
      console.error('Login error:', error);
      return res.status(500).json({
        success: false,
        message: 'Login failed',
      });
    }
  },
);

router.get('/me', authenticate, async (req, res) => res.json({
  success: true,
  data: {
    user: toUserPayload(req.user),
  },
}));

router.put(
  '/profile',
  authenticate,
  validate([
    body('name').optional().trim().isLength({ min: 2 }),
    body('profilePicture').optional().isString(),
  ]),
  async (req, res) => {
    try {
      const { name, profilePicture } = req.body;
      const updates = [];
      const values = [];

      if (name !== undefined) {
        values.push(name);
        updates.push(`name = $${values.length}`);
      }

      if (profilePicture !== undefined) {
        values.push(profilePicture);
        updates.push(`profile_picture = $${values.length}`);
      }

      if (!updates.length) {
        return res.status(400).json({
          success: false,
          message: 'No fields to update',
        });
      }

      values.push(req.user.id);

      const result = await query(
        `UPDATE users
         SET ${updates.join(', ')}, updated_at = NOW()
         WHERE id = $${values.length}
         RETURNING
           id,
           email,
           name,
           role,
           profile_picture AS "profilePicture"`,
        values,
      );

      return res.json({
        success: true,
        message: 'Profile updated successfully',
        data: {
          user: toUserPayload(result.rows[0]),
        },
      });
    } catch (error) {
      console.error('Update profile error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to update profile',
      });
    }
  },
);

router.post(
  '/change-password',
  authenticate,
  validate([
    body('currentPassword').exists(),
    body('newPassword').isLength({ min: 6 }),
  ]),
  async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;
      const result = await query(
        'SELECT password_hash AS "passwordHash" FROM users WHERE id = $1',
        [req.user.id],
      );

      const user = result.rows[0];
      const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);

      if (!isMatch) {
        return res.status(401).json({
          success: false,
          message: 'Current password is incorrect',
        });
      }

      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(newPassword, salt);

      await query(
        'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
        [passwordHash, req.user.id],
      );

      return res.json({
        success: true,
        message: 'Password changed successfully',
      });
    } catch (error) {
      console.error('Change password error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to change password',
      });
    }
  },
);

module.exports = router;
