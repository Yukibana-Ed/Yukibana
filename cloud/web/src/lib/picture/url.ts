import type { PictureId, UserId } from '#lib/ids.ts';

/** Returns the path a page shows `user`'s picture `picture` from, served by `servePicture`. It names one set of bytes
 *  forever (see `PictureId`), so a browser caches it for good and a new picture is a new path. */
export const pictureUrl = (user: UserId, picture: PictureId): string => `/api/users/${user}/pictures/${picture}`;
