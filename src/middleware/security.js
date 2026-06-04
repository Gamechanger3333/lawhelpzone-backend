import helmet from "helmet";
import hpp    from "hpp";

// Strips keys starting with $ or containing . to block NoSQL injection.
// Note: req.params is read-only in Express — only req.body is sanitized here.
const mongoSanitize = () => (req, res, next) => {
  const sanitize = (obj) => {
    if (!obj || typeof obj !== "object") return;
    for (const key of Object.keys(obj)) {
      if (key.startsWith("$") || key.includes(".")) {
        delete obj[key];
      } else {
        sanitize(obj[key]);
      }
    }
  };
  if (req.body) sanitize(req.body);
  next();
};

// Removes common XSS vectors from string values.
// Encodes & first so downstream entity-encoded payloads don't slip through.
const xssProtection = () => (req, res, next) => {
  const clean = (str) => {
    if (typeof str !== "string") return str;
    return str
      .replace(/&/g, "&amp;")
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
      .replace(/javascript:/gi, "")
      .replace(/on\w+\s*=/gi, "")
      .replace(/<embed/gi, "")
      .replace(/<object/gi, "");
  };

  const sanitize = (obj) => {
    if (!obj || typeof obj !== "object") return;
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === "string") {
        obj[key] = clean(obj[key]);
      } else {
        sanitize(obj[key]);
      }
    }
  };

  if (req.body) sanitize(req.body);
  next();
};

export const securityMiddleware = (app) => {
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc:   ["'self'", "'unsafe-inline'"],
        scriptSrc:  ["'self'"],
        imgSrc:     ["'self'", "data:", "https:"],
      },
    },
  }));

  app.use(mongoSanitize());
  app.use(xssProtection());
  app.use(hpp());
};