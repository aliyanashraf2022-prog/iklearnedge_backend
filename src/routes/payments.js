const express = require('express');
const { body, validationResult } = require('express-validator');
const { query, transaction } = require('../models/database');
const { authenticate, requireAdmin, requireStudent } = require('../middleware/auth');
const {
  BOOKING_STATUS,
  DB_BOOKING_STATUS,
  PAYMENT_PROOF_STATUS,
  createNotification,
  getApiBookingStatus,
  getDemoBookingPredicate,
  getBookingById,
  getStudentProfile,
  getTeacherProfile,
} = require('../utils/workflow');

const router = express.Router();

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

const paymentSelect = `
  SELECT
    pp.id,
    pp.booking_id AS "bookingId",
    pp.file_url AS "fileUrl",
    pp.file_name AS "fileName",
    pp.status,
    pp.review_notes AS "reviewNotes",
    pp.uploaded_at AS "uploadedAt",
    pp.reviewed_at AS "reviewedAt",
    b.total_amount AS "totalAmount",
    b.status AS "dbBookingStatus",
    CASE WHEN ${getDemoBookingPredicate('b')} THEN true ELSE false END AS "isDemo",
    b.meeting_link AS "meetingLink",
    b.notes,
    s.id AS "subjectId",
    s.name AS "subjectName",
    su.name AS "studentName",
    tu.name AS "teacherName"
  FROM payment_proofs pp
  JOIN bookings b ON pp.booking_id = b.id
  JOIN subjects s ON b.subject_id = s.id
  JOIN students st ON b.student_id = st.id
  JOIN users su ON st.user_id = su.id
  JOIN teachers t ON b.teacher_id = t.id
  JOIN users tu ON t.user_id = tu.id
`;

const toPaymentPayload = (row) => ({
  ...row,
  bookingStatus: getApiBookingStatus({
    dbStatus: row.dbBookingStatus,
    paymentStatus: row.status,
    meetingLink: row.meetingLink,
    notes: row.notes,
    isDemo: row.isDemo,
  }),
});

router.get('/', authenticate, async (req, res) => {
  try {
    let sql = `${paymentSelect} ORDER BY pp.uploaded_at DESC`;
    let params = [];

    if (req.user.role === 'student') {
      const student = await getStudentProfile(req.user.id);
      if (!student) {
        return res.status(404).json({
          success: false,
          message: 'Student profile not found',
        });
      }

      sql = `${paymentSelect} WHERE b.student_id = $1 ORDER BY pp.uploaded_at DESC`;
      params = [student.id];
    } else if (req.user.role === 'teacher') {
      const teacher = await getTeacherProfile(req.user.id);
      if (!teacher) {
        return res.status(404).json({
          success: false,
          message: 'Teacher profile not found',
        });
      }

      sql = `${paymentSelect} WHERE b.teacher_id = $1 ORDER BY pp.uploaded_at DESC`;
      params = [teacher.id];
    }

    const result = await query(sql, params);
    const data = result.rows.map(toPaymentPayload);

    return res.json({
      success: true,
      count: data.length,
      data,
    });
  } catch (error) {
    console.error('Get payments error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get payments',
    });
  }
});

router.get('/pending', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await query(
      `${paymentSelect}
       WHERE pp.status = $1
       ORDER BY pp.uploaded_at ASC`,
      [PAYMENT_PROOF_STATUS.PENDING],
    );

    const data = result.rows.map(toPaymentPayload);

    return res.json({
      success: true,
      count: data.length,
      data,
    });
  } catch (error) {
    console.error('Get pending payments error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get pending payments',
    });
  }
});

router.post(
  '/',
  authenticate,
  requireStudent,
  validate([
    body('bookingId').notEmpty(),
    body('fileUrl').isString().notEmpty(),
    body('fileName').optional().isString(),
  ]),
  async (req, res) => {
    try {
      const { bookingId, fileUrl, fileName } = req.body;
      const student = await getStudentProfile(req.user.id);

      if (!student) {
        return res.status(404).json({
          success: false,
          message: 'Student profile not found',
        });
      }

      const booking = await getBookingById(bookingId);
      if (!booking || booking.studentId !== student.id) {
        return res.status(404).json({
          success: false,
          message: 'Booking not found',
        });
      }

      if (booking.isDemo) {
        return res.status(400).json({
          success: false,
          message: 'Demo classes do not require payment proof',
        });
      }

      if (booking.status !== BOOKING_STATUS.PENDING_ADMIN) {
        return res.status(400).json({
          success: false,
          message: 'Payment proof can only be uploaded for pending admin requests',
        });
      }

      const created = await transaction(async (client) => {
        const paymentResult = await client.query(
          `INSERT INTO payment_proofs (booking_id, file_url, file_name, status)
           VALUES ($1, $2, $3, $4)
           RETURNING
             id,
             booking_id AS "bookingId",
             file_url AS "fileUrl",
             file_name AS "fileName",
             status,
             review_notes AS "reviewNotes",
             uploaded_at AS "uploadedAt",
             reviewed_at AS "reviewedAt"`,
          [
            bookingId,
            fileUrl,
            fileName || 'payment-proof',
            PAYMENT_PROOF_STATUS.PENDING,
          ],
        );

        await client.query(
          `UPDATE bookings
           SET status = $1, updated_at = NOW()
           WHERE id = $2`,
          [DB_BOOKING_STATUS.PAYMENT_UNDER_REVIEW, bookingId],
        );

        return paymentResult.rows[0];
      });

      return res.status(201).json({
        success: true,
        message: 'Payment proof uploaded successfully',
        data: created,
      });
    } catch (error) {
      console.error('Upload payment proof error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to upload payment proof',
      });
    }
  },
);

router.put(
  '/:id/verify',
  authenticate,
  requireAdmin,
  validate([
    body('status').isIn([PAYMENT_PROOF_STATUS.APPROVED, PAYMENT_PROOF_STATUS.REJECTED]),
    body('notes').optional().isString(),
  ]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { status, notes } = req.body;

      const paymentResult = await query(
        `${paymentSelect}
         WHERE pp.id = $1`,
        [id],
      );

      if (!paymentResult.rows.length) {
        return res.status(404).json({
          success: false,
          message: 'Payment proof not found',
        });
      }

      const payment = paymentResult.rows[0];
      const booking = await getBookingById(payment.bookingId);

      if (!booking) {
        return res.status(404).json({
          success: false,
          message: 'Booking not found',
        });
      }

      const bookingStatus = status === PAYMENT_PROOF_STATUS.APPROVED
        ? DB_BOOKING_STATUS.PENDING_PAYMENT
        : DB_BOOKING_STATUS.CANCELLED;

      const result = await transaction(async (client) => {
        const updatedPayment = await client.query(
          `UPDATE payment_proofs
           SET status = $1,
               review_notes = $2,
               reviewed_at = NOW()
           WHERE id = $3
           RETURNING
             id,
             booking_id AS "bookingId",
             file_url AS "fileUrl",
             file_name AS "fileName",
             status,
             review_notes AS "reviewNotes",
             uploaded_at AS "uploadedAt",
             reviewed_at AS "reviewedAt"`,
          [status, notes || '', id],
        );

        await client.query(
          `UPDATE bookings
           SET status = $1, updated_at = NOW()
           WHERE id = $2`,
          [bookingStatus, payment.bookingId],
        );

        if (status === PAYMENT_PROOF_STATUS.APPROVED) {
          await createNotification(
            client,
            booking.studentUserId,
            'Payment approved',
            `Your payment for ${booking.subjectName} has been approved and sent to ${booking.teacherName}.`,
            'payment_approved',
          );
          await createNotification(
            client,
            booking.teacherUserId,
            'New class request',
            `${booking.studentName} booked ${booking.subjectName}. Review the request and add a class link to accept it.`,
            'class_request',
          );
        } else {
          await createNotification(
            client,
            booking.studentUserId,
            'Payment rejected',
            notes
              ? `Your payment for ${booking.subjectName} was rejected: ${notes}`
              : `Your payment for ${booking.subjectName} was rejected.`,
            'payment_rejected',
          );
        }

        return updatedPayment.rows[0];
      });

      return res.json({
        success: true,
        message: `Payment ${status} successfully`,
        data: result,
      });
    } catch (error) {
      console.error('Verify payment error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to verify payment',
      });
    }
  },
);

module.exports = router;
