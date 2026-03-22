const { query } = require('../models/database');

const BOOKING_STATUS = Object.freeze({
  PENDING_ADMIN: 'pending_admin',
  PENDING_TEACHER: 'pending_teacher',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
});

const DB_BOOKING_STATUS = Object.freeze({
  PENDING_PAYMENT: 'pending_payment',
  PAYMENT_UNDER_REVIEW: 'payment_under_review',
  CONFIRMED: 'confirmed',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
});

const PAYMENT_PROOF_STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
});

const BOOKING_NOTE_MARKERS = Object.freeze({
  REJECTED: '[system:rejected]',
  CANCELLED: '[system:cancelled]',
});

const SAFE_NOTIFICATION_TYPES = new Set(['info', 'success', 'warning', 'error']);

const GRADE_LEVEL_NORMALIZATION = Object.freeze({
  'grade 1': 'Grade 1-5 (Primary)',
  'grade 2': 'Grade 1-5 (Primary)',
  'grade 3': 'Grade 1-5 (Primary)',
  'grade 4': 'Grade 1-5 (Primary)',
  'grade 5': 'Grade 1-5 (Primary)',
  'grade 6': 'Grade 6-8 (Middle)',
  'grade 7': 'Grade 6-8 (Middle)',
  'grade 8': 'Grade 6-8 (Middle)',
  'grade 9': 'Grade 9-10 (Secondary)',
  'grade 10': 'Grade 9-10 (Secondary)',
  primary: 'Grade 1-5 (Primary)',
  middle: 'Grade 6-8 (Middle)',
  secondary: 'Grade 9-10 (Secondary)',
});

const getDemoBookingPredicate = (alias = 'b') => {
  const prefix = alias ? `${alias}.` : '';
  return `((COALESCE(${prefix}total_amount, 0) = 0 AND COALESCE(${prefix}price_per_hour, 0) = 0) OR LOWER(COALESCE(${prefix}notes, '')) LIKE 'demo%')`;
};

const bookingSelect = `
  SELECT
    b.id,
    b.student_id AS "studentId",
    b.teacher_id AS "teacherId",
    b.subject_id AS "subjectId",
    b.grade_level AS "gradeLevel",
    b.scheduled_date AS "scheduledDate",
    b.duration,
    b.price_per_hour AS "pricePerHour",
    b.total_amount AS "totalAmount",
    b.status AS "dbStatus",
    b.meeting_link AS "meetingLink",
    b.notes,
    CASE WHEN ${getDemoBookingPredicate('b')} THEN true ELSE false END AS "isDemo",
    COALESCE(payment."paymentProofUrl", '') AS "receiptUrl",
    b.created_at AS "createdAt",
    b.updated_at AS "updatedAt",
    student_user.id AS "studentUserId",
    student_user.name AS "studentName",
    student_user.email AS "studentEmail",
    student_user.profile_picture AS "studentPicture",
    teacher_user.id AS "teacherUserId",
    teacher_user.name AS "teacherName",
    teacher_user.email AS "teacherEmail",
    teacher_user.profile_picture AS "teacherPicture",
    subject.name AS "subjectName",
    payment."paymentProofId",
    payment."paymentProofUrl",
    payment."paymentProofName",
    payment."paymentStatus",
    payment."paymentReviewNotes",
    payment."paymentReviewedAt",
    payment."paymentUploadedAt"
  FROM bookings b
  JOIN students student_profile ON b.student_id = student_profile.id
  JOIN users student_user ON student_profile.user_id = student_user.id
  JOIN teachers teacher_profile ON b.teacher_id = teacher_profile.id
  JOIN users teacher_user ON teacher_profile.user_id = teacher_user.id
  JOIN subjects subject ON b.subject_id = subject.id
  LEFT JOIN LATERAL (
    SELECT
      id AS "paymentProofId",
      file_url AS "paymentProofUrl",
      file_name AS "paymentProofName",
      status AS "paymentStatus",
      review_notes AS "paymentReviewNotes",
      reviewed_at AS "paymentReviewedAt",
      uploaded_at AS "paymentUploadedAt"
    FROM payment_proofs
    WHERE booking_id = b.id
    ORDER BY uploaded_at DESC
    LIMIT 1
  ) payment ON true
`;

const toDb = (client) => client || { query };

const run = (client, text, params = []) => toDb(client).query(text, params);

const normalizeGradeLevel = (value) => {
  const gradeLevel = String(value || '').trim();
  if (!gradeLevel) {
    return '';
  }

  const lowered = gradeLevel.toLowerCase();
  return GRADE_LEVEL_NORMALIZATION[lowered] || gradeLevel;
};

const getGradeCandidates = (value) => {
  const original = String(value || '').trim();
  const normalized = normalizeGradeLevel(original);
  return [...new Set([original, normalized].filter(Boolean))];
};

const hasMarker = (notes, marker) => String(notes || '').includes(marker);

const normalizeNotificationType = (value) => {
  const normalized = String(value || 'info').trim().toLowerCase();

  if (SAFE_NOTIFICATION_TYPES.has(normalized)) {
    return normalized;
  }

  if (/(rejected|cancelled|canceled|failed|error)/.test(normalized)) {
    return 'error';
  }

  if (/(accepted|approved|completed|verified|verification|success)/.test(normalized)) {
    return 'success';
  }

  if (/(pending|review|request)/.test(normalized)) {
    return 'warning';
  }

  return 'info';
};

const getApiBookingStatus = (row) => {
  const dbStatus = row?.dbStatus || row?.status || '';
  const paymentStatus = row?.paymentStatus || '';
  const meetingLink = row?.meetingLink || '';
  const notes = row?.notes || '';
  const isDemo = Boolean(row?.isDemo);

  switch (dbStatus) {
    case DB_BOOKING_STATUS.PAYMENT_UNDER_REVIEW:
      return BOOKING_STATUS.PENDING_ADMIN;
    case DB_BOOKING_STATUS.PENDING_PAYMENT:
      if (isDemo || paymentStatus === PAYMENT_PROOF_STATUS.APPROVED) {
        return BOOKING_STATUS.PENDING_TEACHER;
      }
      return BOOKING_STATUS.PENDING_ADMIN;
    case DB_BOOKING_STATUS.CONFIRMED:
      return meetingLink ? BOOKING_STATUS.ACCEPTED : BOOKING_STATUS.PENDING_TEACHER;
    case DB_BOOKING_STATUS.COMPLETED:
      return BOOKING_STATUS.COMPLETED;
    case DB_BOOKING_STATUS.CANCELLED:
      if (
        paymentStatus === PAYMENT_PROOF_STATUS.REJECTED
        || hasMarker(notes, BOOKING_NOTE_MARKERS.REJECTED)
      ) {
        return BOOKING_STATUS.REJECTED;
      }
      return BOOKING_STATUS.CANCELLED;
    default:
      return dbStatus;
  }
};

const toBookingPayload = (row) => {
  if (!row) {
    return null;
  }

  return {
    ...row,
    dbStatus: row.dbStatus || row.status || '',
    status: getApiBookingStatus(row),
    isDemo: Boolean(row.isDemo),
    receiptUrl: row.receiptUrl || row.paymentProofUrl || '',
  };
};

const toBookingPayloads = (rows = []) => rows.map(toBookingPayload);

const createNotification = async (client, userId, title, message, type = 'info') => {
  await run(
    client,
    `INSERT INTO notifications (user_id, title, message, type)
     VALUES ($1, $2, $3, $4)`,
    [userId, title, message, normalizeNotificationType(type)],
  );
};

const getStudentProfile = async (userId, client) => {
  const result = await run(
    client,
    `SELECT
       s.id,
       s.user_id AS "userId",
       s.grade_level AS "gradeLevel",
       s.parent_contact AS "parentContact",
       s.location,
       u.name,
       u.email,
       u.profile_picture AS "profilePicture"
     FROM students s
     JOIN users u ON s.user_id = u.id
     WHERE s.user_id = $1`,
    [userId],
  );
  return result.rows[0] || null;
};

const getTeacherProfile = async (userId, client) => {
  const result = await run(
    client,
    `SELECT
       t.id,
       t.user_id AS "userId",
       t.bio,
       t.verification_status AS "verificationStatus",
       t.is_live AS "isLive",
       t.meeting_link AS "meetingLink",
       u.name,
       u.email,
       u.profile_picture AS "profilePicture"
     FROM teachers t
     JOIN users u ON t.user_id = u.id
     WHERE t.user_id = $1`,
    [userId],
  );
  return result.rows[0] || null;
};

const getTeacherSubjects = async (teacherId, client) => {
  const result = await run(
    client,
    `SELECT s.id, s.name
     FROM teacher_subjects ts
     JOIN subjects s ON ts.subject_id = s.id
     WHERE ts.teacher_id = $1
     ORDER BY s.name`,
    [teacherId],
  );
  return result.rows;
};

const getTeacherAvailability = async (teacherId, client) => {
  const result = await run(
    client,
    `SELECT
       id,
       day,
       start_time AS "startTime",
       end_time AS "endTime",
       is_available AS "isAvailable"
     FROM availability
     WHERE teacher_id = $1
     ORDER BY
       CASE day
         WHEN 'monday' THEN 1
         WHEN 'tuesday' THEN 2
         WHEN 'wednesday' THEN 3
         WHEN 'thursday' THEN 4
         WHEN 'friday' THEN 5
         WHEN 'saturday' THEN 6
         WHEN 'sunday' THEN 7
         ELSE 8
       END,
       start_time`,
    [teacherId],
  );
  return result.rows;
};

const getTeacherDocuments = async (teacherId, client) => {
  const result = await run(
    client,
    `SELECT
       id,
       type,
       file_url AS "fileUrl",
       file_name AS "fileName",
       uploaded_at AS "uploadedAt"
     FROM documents
     WHERE teacher_id = $1
     ORDER BY uploaded_at DESC`,
    [teacherId],
  );
  return result.rows;
};

const getBookingById = async (bookingId, client) => {
  const result = await run(
    client,
    `${bookingSelect}
     WHERE b.id = $1`,
    [bookingId],
  );
  return toBookingPayload(result.rows[0]);
};

const requireTeacherSubject = async (teacherId, subjectId, client) => {
  const result = await run(
    client,
    `SELECT 1
     FROM teacher_subjects
     WHERE teacher_id = $1 AND subject_id = $2`,
    [teacherId, subjectId],
  );
  return result.rows.length > 0;
};

const getPricingForGrade = async (subjectId, gradeLevel, client) => {
  const candidates = getGradeCandidates(gradeLevel);
  const result = await run(
    client,
    `SELECT
       id,
       subject_id AS "subjectId",
       grade_level AS "gradeLevel",
       price_per_hour AS "pricePerHour"
     FROM pricing_tiers
     WHERE subject_id = $1
       AND grade_level = ANY($2::text[])
     ORDER BY CASE WHEN grade_level = $3 THEN 0 ELSE 1 END
     LIMIT 1`,
    [subjectId, candidates, String(gradeLevel || '').trim()],
  );
  return result.rows[0] || null;
};

module.exports = {
  BOOKING_STATUS,
  BOOKING_NOTE_MARKERS,
  DB_BOOKING_STATUS,
  PAYMENT_PROOF_STATUS,
  bookingSelect,
  createNotification,
  getApiBookingStatus,
  getDemoBookingPredicate,
  getGradeCandidates,
  getBookingById,
  getPricingForGrade,
  getStudentProfile,
  getTeacherAvailability,
  getTeacherDocuments,
  getTeacherProfile,
  getTeacherSubjects,
  normalizeGradeLevel,
  normalizeNotificationType,
  requireTeacherSubject,
  run,
  toBookingPayload,
  toBookingPayloads,
};
