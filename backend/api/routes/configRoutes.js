/**
 * Runtime Configuration Routes
 *
 * @module routes/configRoutes
 */

import express from 'express';
import configController from '../controllers/configController.js';

const router = express.Router();

// GET /api/config/checksum — returns instance configuration checksum & setting hashes
router.get('/checksum', configController.getConfigChecksum);

// GET /api/config — returns configuration summary with checksum and masked settings
router.get('/', configController.getRuntimeConfig);

export default router;
