import ImageKit from "@imagekit/nodejs";
import {
  IMAGEKIT_PUBLIC_KEY,
  IMAGEKIT_PRIVATE_KEY,
  IMAGEKIT_URL_ENDPOINT,
} from "../config.js";
import { HttpError } from "../utils/http.js";

const configured = Boolean(IMAGEKIT_PUBLIC_KEY && IMAGEKIT_PRIVATE_KEY && IMAGEKIT_URL_ENDPOINT);

const imagekit = configured
  ? new ImageKit({
      publicKey: IMAGEKIT_PUBLIC_KEY,
      privateKey: IMAGEKIT_PRIVATE_KEY,
      urlEndpoint: IMAGEKIT_URL_ENDPOINT,
    })
  : null;

export const isImageKitConfigured = () => configured;

const resolveAuthMethod = () => {
  if (!imagekit) {
    return null;
  }

  if (typeof imagekit.getAuthenticationParameters === "function") {
    return imagekit.getAuthenticationParameters.bind(imagekit);
  }

  if (typeof imagekit?.helper?.getAuthenticationParameters === "function") {
    return imagekit.helper.getAuthenticationParameters.bind(imagekit.helper);
  }

  return null;
};

const resolveUploadMethod = () => {
  if (!imagekit) {
    return null;
  }

  if (typeof imagekit.upload === "function") {
    return imagekit.upload.bind(imagekit);
  }

  if (typeof imagekit?.files?.upload === "function") {
    return imagekit.files.upload.bind(imagekit.files);
  }

  return null;
};

const getHeaderValue = (headers, key) => {
  if (!headers) {
    return "";
  }

  if (typeof headers.get === "function") {
    return String(headers.get(key) || headers.get(key.toLowerCase()) || "").trim();
  }

  return String(headers[key] || headers[key.toLowerCase()] || "").trim();
};

const mapImageKitError = (error, message) => {
  if (error instanceof HttpError) {
    return error;
  }

  const providerStatus = Number(error?.status || error?.statusCode || 500);
  const statusCode =
    providerStatus >= 400 && providerStatus < 500 ? providerStatus : 502;

  const requestId =
    getHeaderValue(error?.headers, "x-ik-requestid") ||
    getHeaderValue(error?.headers, "x-request-id");

  return new HttpError(statusCode, message, {
    code: "IMAGEKIT_REQUEST_FAILED",
    provider: "imagekit",
    providerStatus,
    ...(requestId ? { requestId } : {}),
  });
};

const parseDataUri = (dataUri) => {
  const match = String(dataUri || "").match(/^data:(.+);base64,(.+)$/);
  if (!match) {
    throw new HttpError(400, "Invalid data URI.");
  }

  return {
    mimeType: match[1],
    base64Data: match[2],
  };
};

export const getImageKitUploadAuth = (tokenPayload = {}) => {
  if (!configured || !imagekit) {
    throw new HttpError(503, "ImageKit is not configured.");
  }

  const getAuthenticationParameters = resolveAuthMethod();
  if (!getAuthenticationParameters) {
    throw new HttpError(503, "ImageKit SDK does not support upload auth in current setup.");
  }

  try {
    const authParams = getAuthenticationParameters(tokenPayload);
    return {
      ...authParams,
      publicKey: IMAGEKIT_PUBLIC_KEY,
      urlEndpoint: IMAGEKIT_URL_ENDPOINT,
    };
  } catch (error) {
    throw mapImageKitError(error, "ImageKit auth generation failed. Please retry.");
  }
};

export const uploadDataUriToImageKit = async ({
  dataUri,
  fileName,
  folder = "/kanchana-ai",
  tags = [],
}) => {
  if (!configured || !imagekit) {
    throw new HttpError(503, "ImageKit is not configured.");
  }

  const { mimeType, base64Data } = parseDataUri(dataUri);
  const extension = mimeType.split("/")[1] || "png";
  const uploadFile = resolveUploadMethod();
  if (!uploadFile) {
    throw new HttpError(503, "ImageKit SDK does not support upload in current setup.");
  }

  let result;
  try {
    result = await uploadFile({
      file: base64Data,
      fileName: `${fileName}.${extension}`,
      folder,
      tags,
    });
  } catch (error) {
    throw mapImageKitError(error, "Image upload failed. Please retry.");
  }

  return {
    url: result.url,
    thumbnailUrl: result.thumbnailUrl,
    fileId: result.fileId,
  };
};

export const uploadImageUrlToImageKit = async ({
  imageUrl,
  fileName,
  folder = "/kanchana-ai",
  tags = [],
}) => {
  if (!configured || !imagekit) {
    throw new HttpError(503, "ImageKit is not configured.");
  }

  const uploadFile = resolveUploadMethod();
  if (!uploadFile) {
    throw new HttpError(503, "ImageKit SDK does not support upload in current setup.");
  }

  let result;
  try {
    result = await uploadFile({
      file: imageUrl,
      fileName,
      useUniqueFileName: true,
      folder,
      tags,
    });
  } catch (error) {
    throw mapImageKitError(error, "Image upload failed. Please retry.");
  }

  return {
    url: result.url,
    thumbnailUrl: result.thumbnailUrl,
    fileId: result.fileId,
  };
};
