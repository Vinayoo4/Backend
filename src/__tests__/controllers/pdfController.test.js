const { generateReport } = require('../../controllers/pdfController');
const pdfService = require('../../services/pdfService');
const logger = require('../../config/logger');

jest.mock('../../services/pdfService');
jest.mock('../../config/logger');

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

  describe('generateReport', () => {
    it('should generate a report PDF with a sanitized filename from title', async () => {
      req.body = {
        title: 'My !@# Awesome %^& Report 2023!!',
        data: 'some data',
      };

      const mockBuffer = Buffer.from('fake-pdf-content');
      pdfService.generateReport.mockResolvedValue(mockBuffer);

      // Mock Date.now to have predictable filename
      const mockDateNow = jest.spyOn(Date, 'now').mockReturnValue(1680000000000);

      await generateReport(req, res);

      expect(pdfService.generateReport).toHaveBeenCalledWith(req.body, req.body.title);
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');

      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="my_____awesome_____report_2023__-1680000000000.pdf"'
      );
      expect(res.send).toHaveBeenCalledWith(mockBuffer);

      mockDateNow.mockRestore();
    });

    it('should fallback to req.query.title or "Hotel Report" if body.title is missing', async () => {
      req.body = { data: 'some data' };
      req.query = { title: 'Query Title!' };

      const mockBuffer = Buffer.from('fake-pdf-content');
      pdfService.generateReport.mockResolvedValue(mockBuffer);

      const mockDateNow = jest.spyOn(Date, 'now').mockReturnValue(1680000000000);

      await generateReport(req, res);

      expect(pdfService.generateReport).toHaveBeenCalledWith(req.body, 'Query Title!');

      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="query_title_-1680000000000.pdf"'
      );

      mockDateNow.mockRestore();
    });

    it('should return 400 if req.body is not an object', async () => {
      req.body = null;

      await generateReport(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Report data required.' });
    });

    it('should handle service errors and return 500', async () => {
      req.body = { title: 'Error Report' };
      const error = new Error('PDF generation failed');
      pdfService.generateReport.mockRejectedValue(error);

      await generateReport(req, res);

      expect(logger.error).toHaveBeenCalledWith('PDF report generation error:', error.message);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: error.message });
    });
  });
});
