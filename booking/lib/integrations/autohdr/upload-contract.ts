const TRUSTED_UPLOAD_HOST = "image-upload-autohdr-j.s3.amazonaws.com";
const REQUIRED_CONTENT_TYPE = "application/octet-stream";
const REQUIRED_ACL = "private";
const REQUIRED_QUERY_KEYS = new Set([
  "AWSAccessKeyId",
  "Signature",
  "content-type",
  "x-amz-acl",
  "Expires",
]);

export type AutoHDRUploadDestination = {
  url: string;
  method: "PUT";
  headers: {
    "Content-Type": "application/octet-stream";
    "x-amz-acl": "private";
  };
};

export type AutoHDRPreparedUpload = AutoHDRUploadDestination & {
  filename: string;
};

export function parseAutoHDRUploadDestination(value: string): AutoHDRUploadDestination {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("AutoHDR upload destination is invalid.");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== TRUSTED_UPLOAD_HOST ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new Error("AutoHDR upload destination is not trusted.");
  }

  const keys = [...url.searchParams.keys()];
  if (
    keys.length !== REQUIRED_QUERY_KEYS.size ||
    keys.some((key) => !REQUIRED_QUERY_KEYS.has(key)) ||
    [...REQUIRED_QUERY_KEYS].some((key) => !url.searchParams.has(key))
  ) {
    throw new Error("AutoHDR upload destination has unsupported signing fields.");
  }
  if (url.searchParams.get("content-type") !== REQUIRED_CONTENT_TYPE) {
    throw new Error("AutoHDR upload content type is unsupported.");
  }
  if (url.searchParams.get("x-amz-acl") !== REQUIRED_ACL) {
    throw new Error("AutoHDR upload ACL is unsupported.");
  }
  const expires = url.searchParams.get("Expires") ?? "";
  if (!/^\d{10,13}$/.test(expires)) {
    throw new Error("AutoHDR upload expiry is invalid.");
  }
  for (const key of ["AWSAccessKeyId", "Signature"] as const) {
    const part = url.searchParams.get(key);
    if (!part || part.length > 512 || /[\u0000-\u001f\u007f]/.test(part)) {
      throw new Error("AutoHDR upload signature is invalid.");
    }
  }

  return {
    url: url.toString(),
    method: "PUT",
    headers: {
      "Content-Type": REQUIRED_CONTENT_TYPE,
      "x-amz-acl": REQUIRED_ACL,
    },
  };
}

export function pairAutoHDRUploadDestinations(
  filenames: string[],
  uploadedFiles: string[],
): AutoHDRPreparedUpload[] {
  if (filenames.length !== uploadedFiles.length) {
    throw new Error("AutoHDR upload destination count did not match the requested files.");
  }
  return filenames.map((filename, index) => ({
    filename,
    ...parseAutoHDRUploadDestination(uploadedFiles[index]),
  }));
}
