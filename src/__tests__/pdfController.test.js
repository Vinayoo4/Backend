const { generateInvoice, generateReport } = require('../controllers/pdfController');
const { generateInvoicePdf, generateReport: generateReportPdf } = require('../services/pdfService');
const logger = require('../config/logger');

jest.mock('../services/pdfService', () => ({
  generateInvoicePdf: jest.fn(),
  generateReport: jest.fn(),
}));

jest.mock('../config/logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

describe('pdfController', () => {
  let req;
  let res;

  beforeEach(() => {
    req = {
      body: {},
      query: {},
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      setHeader: jest.fn(),
      send: jest.fn(),
    };
    jest.clearAllMocks();
  });

  describe('generateInvoice', () => {
    it('returns 400 if invoice data is missing or not an object', async () => {
      req.body = null;
      await generateInvoice(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Invoice data required.' });

      req.body = 'not an object';
      await generateInvoice(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Invoice data required.' });
    });

    it('generates invoice successfully and sets headers', async () => {
      req.body = { invoiceNumber: 'INV-123' };
      const mockBuffer = Buffer.from('test pdf content');
      generateInvoicePdf.mockResolvedValue(mockBuffer);

      await generateInvoice(req, res);

      expect(generateInvoicePdf).toHaveBeenCalledWith(req.body);
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringMatching(/attachment; filename="invoice-INV-123\.pdf"/)
      );
      expect(res.send).toHaveBeenCalledWith(mockBuffer);
    });

    it('returns 500 if an error occurs during PDF generation', async () => {
      req.body = { invoiceNumber: 'INV-123' };
      const mockError = new Error('PDF Generation Failed');
      generateInvoicePdf.mockRejectedValue(mockError);

      await generateInvoice(req, res);

      expect(logger.error).toHaveBeenCalledWith('PDF invoice generation error:', 'PDF Generation Failed');
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'PDF Generation Failed' });
    });
  });

  describe('generateReport', () => {
    it('returns 400 if report data is missing or not an object', async () => {
      req.body = null;
      await generateReport(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Report data required.' });

      req.body = 'not an object';
      await generateReport(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Report data required.' });
    });

    it('generates report successfully with body title', async () => {
      req.body = { title: 'Monthly Report', summary: {} };
      const mockBuffer = Buffer.from('report pdf content');
      generateReportPdf.mockResolvedValue(mockBuffer);

      await generateReport(req, res);

      expect(generateReportPdf).toHaveBeenCalledWith(req.body, 'Monthly Report');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringMatching(/attachment; filename="monthly_report-\d+\.pdf"/)
      );
      expect(res.send).toHaveBeenCalledWith(mockBuffer);
    });

    it('generates report successfully with query title', async () => {
      req.body = { summary: {} };
      req.query = { title: 'Query Report' };
      const mockBuffer = Buffer.from('report pdf content');
      generateReportPdf.mockResolvedValue(mockBuffer);

      await generateReport(req, res);

      expect(generateReportPdf).toHaveBeenCalledWith(req.body, 'Query Report');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringMatching(/attachment; filename="query_report-\d+\.pdf"/)
      );
      expect(res.send).toHaveBeenCalledWith(mockBuffer);
    });

    it('generates report with default title if no title provided', async () => {
      req.body = { summary: {} };
      const mockBuffer = Buffer.from('report pdf content');
      generateReportPdf.mockResolvedValue(mockBuffer);

      await generateReport(req, res);

      expect(generateReportPdf).toHaveBeenCalledWith(req.body, 'Hotel Report');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringMatching(/attachment; filename="hotel_report-\d+\.pdf"/)
      );
      expect(res.send).toHaveBeenCalledWith(mockBuffer);
    });

    it('returns 500 if an error occurs during PDF generation', async () => {
      req.body = { title: 'Monthly Report' };
      const mockError = new Error('Report Generation Failed');
      generateReportPdf.mockRejectedValue(mockError);

      await generateReport(req, res);

      expect(logger.error).toHaveBeenCalledWith('PDF report generation error:', 'Report Generation Failed');
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Report Generation Failed' });
    });
  });
});
