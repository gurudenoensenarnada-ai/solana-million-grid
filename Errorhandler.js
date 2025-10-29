/**
 * Error Handling Middleware
 */

const config = require('../config');

/**
 * 404 Not Found handler
 */
function notFoundHandler(req, res, next) {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  res.status(404);
  next(error);
}

/**
 * Global error handler
 */
function errorHandler(err, req, res, next) {
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  
  const response = {
    error: err.message || 'Internal Server Error',
    status: statusCode,
  };

  // Add stack trace in development
  if (config.isDevelopment) {
    response.stack = err.stack;
    response.path = req.originalUrl;
    response.method = req.method;
  }

  // Log error
  console.error('❌ Error:', {
    message: err.message,
    status: statusCode,
    path: req.originalUrl,
    method: req.method,
    ...(config.isDevelopment && { stack: err.stack })
  });

  res.status(statusCode).json(response);
}

/**
 * Async handler wrapper to catch errors in async routes
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Validation error handler
 */
function validationErrorHandler(errors) {
  return {
    error: 'Validation failed',
    details: errors
  };
}

module.exports = {
  notFoundHandler,
  errorHandler,
  asyncHandler,
  validationErrorHandler
};
