import { get as getBlob, put } from "@vercel/blob";

import { MARKDOWN_CONTENT_TYPE } from "@/lib/constants";

export function skillBlobPath(skillId: string, contentSha256: string) {
  return `skills/${skillId}/${contentSha256}.md`;
}

export async function uploadSkillContent(
  skillId: string,
  contentSha256: string,
  content: string,
) {
  const pathname = skillBlobPath(skillId, contentSha256);

  await put(pathname, Buffer.from(content, "utf8"), {
    access: "private",
    addRandomSuffix: false,
    cacheControlMaxAge: 31_536_000,
    contentType: MARKDOWN_CONTENT_TYPE,
  });

  return pathname;
}

export async function getSkillContentBlob(pathname: string) {
  return getBlob(pathname, { access: "private" });
}
