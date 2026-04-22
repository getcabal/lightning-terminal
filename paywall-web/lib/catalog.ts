import { get as getEdgeConfigItem } from "@vercel/edge-config";
import type { PoolClient } from "pg";

import { getOptionalDb, withTransaction } from "@/lib/db";
import type {
  PublishSkillInput,
  PublishedSkillVersion,
} from "@/lib/types";

const EDGE_CONFIG_PREFIX = "l402:skills:";

function edgeConfigKey(skillId: string) {
  return `${EDGE_CONFIG_PREFIX}${skillId}`;
}

function rowToSkill(row: {
  skill_id: string;
  title: string;
  summary: string;
  price_sats: string | number;
  content_sha256: string;
  blob_path: string;
  is_active: boolean;
  created_at?: Date | string;
}): PublishedSkillVersion {
  return {
    skillId: row.skill_id,
    title: row.title,
    summary: row.summary,
    priceSats: Number(row.price_sats),
    contentSha256: row.content_sha256,
    blobPath: row.blob_path,
    isActive: row.is_active,
    createdAt:
      typeof row.created_at === "string"
        ? row.created_at
        : row.created_at?.toISOString(),
  };
}

async function getCurrentSkillFromEdgeConfig(skillId: string) {
  if (!process.env.EDGE_CONFIG) {
    return null;
  }

  try {
    return (
      (await getEdgeConfigItem<PublishedSkillVersion>(edgeConfigKey(skillId))) ??
      null
    );
  } catch (error) {
    console.warn("edge-config lookup failed", error);
    return null;
  }
}

export async function getCurrentSkillVersion(skillId: string) {
  const fromEdgeConfig = await getCurrentSkillFromEdgeConfig(skillId);
  if (fromEdgeConfig) {
    return fromEdgeConfig;
  }

  const db = getOptionalDb();
  if (!db) {
    return null;
  }

  const result = await db.query(
    `
      select
        skill_id,
        title,
        summary,
        price_sats,
        content_sha256,
        blob_path,
        is_active,
        created_at
      from skill_versions
      where skill_id = $1 and is_active = true
      order by created_at desc
      limit 1
    `,
    [skillId],
  );

  return result.rows[0] ? rowToSkill(result.rows[0]) : null;
}

export async function getSkillVersion(skillId: string, contentSha256: string) {
  const current = await getCurrentSkillFromEdgeConfig(skillId);
  if (current?.contentSha256 === contentSha256) {
    return current;
  }

  const db = getOptionalDb();
  if (!db) {
    return null;
  }

  const result = await db.query(
    `
      select
        skill_id,
        title,
        summary,
        price_sats,
        content_sha256,
        blob_path,
        is_active,
        created_at
      from skill_versions
      where skill_id = $1 and content_sha256 = $2
      limit 1
    `,
    [skillId, contentSha256],
  );

  return result.rows[0] ? rowToSkill(result.rows[0]) : null;
}

async function upsertSkillVersion(
  client: PoolClient,
  input: PublishSkillInput & {
    blobPath: string;
    contentSha256: string;
  },
) {
  await client.query(
    `
      update skill_versions
      set is_active = false
      where skill_id = $1 and content_sha256 <> $2
    `,
    [input.skillId, input.contentSha256],
  );

  const result = await client.query(
    `
      insert into skill_versions (
        skill_id,
        content_sha256,
        title,
        summary,
        price_sats,
        blob_path,
        is_active
      ) values ($1, $2, $3, $4, $5, $6, true)
      on conflict (skill_id, content_sha256) do update
      set
        title = excluded.title,
        summary = excluded.summary,
        price_sats = excluded.price_sats,
        blob_path = excluded.blob_path,
        is_active = true
      returning
        skill_id,
        title,
        summary,
        price_sats,
        content_sha256,
        blob_path,
        is_active,
        created_at
    `,
    [
      input.skillId,
      input.contentSha256,
      input.title,
      input.summary,
      input.priceSats,
      input.blobPath,
    ],
  );

  return rowToSkill(result.rows[0]);
}

async function syncSkillToEdgeConfig(skill: PublishedSkillVersion) {
  const edgeConfigId = process.env.VERCEL_EDGE_CONFIG_ID;
  const accessToken = process.env.VERCEL_ACCESS_TOKEN;

  if (!edgeConfigId || !accessToken) {
    return;
  }

  const url = new URL(`https://api.vercel.com/v1/edge-config/${edgeConfigId}/items`);
  if (process.env.VERCEL_TEAM_ID) {
    url.searchParams.set("teamId", process.env.VERCEL_TEAM_ID);
  }

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      items: [
        {
          operation: "upsert",
          key: edgeConfigKey(skill.skillId),
          value: skill,
        },
      ],
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `failed to sync Edge Config: ${response.status} ${await response.text()}`,
    );
  }
}

export async function publishSkillVersion(
  input: PublishSkillInput & {
    blobPath: string;
    contentSha256: string;
  },
) {
  const skill = await withTransaction((client) => upsertSkillVersion(client, input));
  await syncSkillToEdgeConfig(skill);
  return skill;
}
