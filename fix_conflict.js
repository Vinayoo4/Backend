const fs = require('fs');
let code = fs.readFileSync('src/routes/invoiceRoutes.js', 'utf8');

code = code.replace(
  `<<<<<<< HEAD
  sendInvoiceEmail
=======
>>>>>>> origin/main`,
  `  sendInvoiceEmail,`
);

fs.writeFileSync('src/routes/invoiceRoutes.js', code);
