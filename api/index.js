let app;
let bootError = null;

try {
  app = require('../server/index');
} catch (err) {
  bootError = err;
  console.error('[Vercel Boot Error]: Failed to load server/index:', err);
}

module.exports = async (req, res) => {
  if (bootError) {
    return res.status(500).json({
      error: true,
      message: 'Server Boot Failure: ' + bootError.message,
      stack: bootError.stack
    });
  }

  try {
    if (!app) {
      app = require('../server/index');
    }
    return app(req, res);
  } catch (err) {
    console.error('[Vercel Serverless Exception]:', err);
    return res.status(500).json({
      error: true,
      message: err.message || 'Unhandled Serverless Exception',
      stack: err.stack
    });
  }
};
