module.exports = function handler(req, res) {
  const preview=process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_GIT_COMMIT_REF === 'feat/calendar-release';
  const secret=String(process.env.CLINIC_SERVER_SECRET || '');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = 200;
  res.end(JSON.stringify({preview,...(preview?{cloudLoginReady:secret.length>=32,cloudLoginIssue:secret.length>=32?null:secret.length===0?'missing':'invalid-length'}:{})}));
};
