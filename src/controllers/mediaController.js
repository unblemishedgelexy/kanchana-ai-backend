import { asyncHandler, HttpError } from "../utils/http.js";
import {
  getImageKitUploadAuth,
  uploadDataUriToImageKit,
  uploadImageUrlToImageKit,
} from "../services/imageKitService.js";
import {
  save,
  setProfileImageUrl,
  setUpgradeAssetUrl,
  toSafeUser,
} from "../repositories/userRepository.js";

const getUserId = (user) => String(user?.id || user?._id || "");

export const getUploadAuth = asyncHandler(async (req, res) => {
  const userId = getUserId(req.user);
  const auth = getImageKitUploadAuth({ userId });
  return res.json(auth);
});

const uploadFromInput = async ({ body, fileName, folder, tags }) => {
  const dataUri = String(body?.dataUri || "");
  const imageUrl = String(body?.imageUrl || "");

  if (dataUri) {
    return uploadDataUriToImageKit({
      dataUri,
      fileName,
      folder,
      tags,
    });
  }

  if (imageUrl) {
    return uploadImageUrlToImageKit({
      imageUrl,
      fileName,
      folder,
      tags,
    });
  }

  throw new HttpError(400, "Provide either dataUri or imageUrl.");
};

export const uploadProfileImage = asyncHandler(async (req, res) => {
  const userId = getUserId(req.user);
  const uploaded = await uploadFromInput({
    body: req.body,
    fileName: `profile-${userId}-${Date.now()}`,
    folder: `/kanchana-ai/users/${userId}/profile`,
    tags: ["profile", userId],
  });

  setProfileImageUrl(req.user, uploaded.url);
  await save(req.user);

  return res.status(201).json({
    message: "Profile image uploaded.",
    image: uploaded,
    user: toSafeUser(req.user),
  });
});

export const uploadUpgradeAsset = asyncHandler(async (req, res) => {
  const userId = getUserId(req.user);
  const uploaded = await uploadFromInput({
    body: req.body,
    fileName: `upgrade-${userId}-${Date.now()}`,
    folder: `/kanchana-ai/users/${userId}/upgrade-assets`,
    tags: ["upgrade", userId],
  });

  setUpgradeAssetUrl(req.user, uploaded.url);
  await save(req.user);

  return res.status(201).json({
    message: "Upgrade asset uploaded to cloud storage.",
    asset: uploaded,
    user: toSafeUser(req.user),
  });
});
