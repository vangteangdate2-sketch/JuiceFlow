import { compressImageBlobToDataUrl } from '../utils/image';

export interface DriveImageFile {
  id: string;
  name: string;
  mimeType: string;
  thumbnailLink?: string;
  modifiedTime?: string;
  size?: string;
}

export interface DriveImageListResult {
  files: DriveImageFile[];
  nextPageToken?: string;
}

export class DriveAuthExpiredError extends Error {
  constructor() {
    super('Google Drive session expired. Please sign in again.');
    this.name = 'DriveAuthExpiredError';
  }
}

export async function listDriveImages(
  accessToken: string,
  searchQuery = '',
  pageToken?: string
): Promise<DriveImageListResult> {
  const escapedSearch = searchQuery.trim().replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const queryParts = ["mimeType contains 'image/'", 'trashed = false'];
  if (escapedSearch) {
    queryParts.push(`name contains '${escapedSearch}'`);
  }

  const params = new URLSearchParams({
    q: queryParts.join(' and '),
    fields: 'nextPageToken,files(id,name,mimeType,thumbnailLink,modifiedTime,size)',
    orderBy: 'modifiedTime desc',
    pageSize: '24',
  });
  if (pageToken) {
    params.set('pageToken', pageToken);
  }

  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (res.status === 401 || res.status === 403) {
    throw new DriveAuthExpiredError();
  }

  if (!res.ok) {
    throw new Error(`Google Drive request failed (${res.status}).`);
  }

  const data = (await res.json()) as {
    files?: DriveImageFile[];
    nextPageToken?: string;
  };

  return {
    files: Array.isArray(data.files) ? data.files : [],
    nextPageToken: data.nextPageToken,
  };
}

export async function downloadDriveImageAsDataUrl(
  accessToken: string,
  fileId: string
): Promise<string> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (res.status === 401 || res.status === 403) {
    throw new DriveAuthExpiredError();
  }

  if (!res.ok) {
    throw new Error(`Could not download image from Google Drive (${res.status}).`);
  }

  const blob = await res.blob();
  return compressImageBlobToDataUrl(blob);
}
