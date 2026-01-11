import express from 'express'
import { getAnalyticsOverview } from '../controllers/analyticsController'


const router = express.Router()

router.get('/admin', getAnalyticsOverview)

export default router