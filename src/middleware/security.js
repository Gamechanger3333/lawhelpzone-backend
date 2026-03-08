// backend/src/middleware/security.js
import helmet from 'helmet';
import hpp from 'hpp';

// Custom MongoDB sanitization middleware (Express 5 compatible)
const mongoSanitize = () => {
  return (req, res, next) => {
    const sanitize = (obj) => {
      if (obj && typeof obj === 'object') {
        Object.keys(obj).forEach((key) => {
          // Remove keys that start with $ or contain .
          if (key.startsWith('$') || key.includes('.')) {
            delete obj[key];
          } else if (typeof obj[key] === 'object') {
            sanitize(obj[key]);
          }
        });
      }
      return obj;
    };

    if (req.body) req.body = sanitize(req.body);
    if (req.params) req.params = sanitize(req.params);

    next();
  };
};

// Custom XSS protection middleware (Express 5 compatible)
const xssProtection = () => {
  return (req, res, next) => {
    const cleanString = (str) => {
      if (typeof str !== 'string') return str;
      
      // Remove common XSS patterns
      return str
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+\s*=/gi, '')
        .replace(/<embed/gi, '')
        .replace(/<object/gi, '');
    };

    const sanitize = (obj) => {
      if (!obj || typeof obj !== 'object') {
        return cleanString(obj);
      }

      Object.keys(obj).forEach((key) => {
        if (typeof obj[key] === 'string') {
          obj[key] = cleanString(obj[key]);
        } else if (typeof obj[key] === 'object') {
          sanitize(obj[key]);
        }
      });

      return obj;
    };

    if (req.body) req.body = sanitize(req.body);
    if (req.params) req.params = sanitize(req.params);

    next();
  };
};

export const securityMiddleware = (app) => {
  // Set security HTTP headers
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
      },
    },
  }));

  // Data sanitization against NoSQL query injection
  app.use(mongoSanitize());

  // Data sanitization against XSS
  app.use(xssProtection());

  // Prevent HTTP Parameter Pollution
  app.use(hpp());
};