import express from "express";
import { authRequired } from "../middleware/auth.js";
import { getUploadAuth, uploadProfileImage, uploadUpgradeAsset } from "../controllers/mediaController.js";

const router = express.Router();

router.use(authRequired);
router.get("/imagekit/auth", getUploadAuth);
router.post("/profile-image", uploadProfileImage);
router.post("/upgrade-asset", uploadUpgradeAsset);

export default router;
