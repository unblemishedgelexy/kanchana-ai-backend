import express from "express";
import { health, ping } from "../controllers/systemController.js";

const router = express.Router();

router.get("/health", health);
router.get("/ping", ping);

export default router;
