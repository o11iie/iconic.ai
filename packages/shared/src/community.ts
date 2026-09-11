// These match the backend's Prisma enums exactly (see
// apps/backend/prisma/schema.prisma) — kept in sync manually since
// Prisma's generated client type isn't importable from the mobile app.
export type ReactionKind = "HYPE" | "LOVE" | "MINDBLOWN" | "LAUGH" | "SKEPTICAL";

export type PostKind = "DISCUSSION" | "PREDICTION" | "THEORY" | "REVIEW";

export interface CommunityPost {
  id: string;
  authorId: string;
  authorHandle: string;
  titleId: string; // the TitleSummary.id this post is about
  kind: PostKind;
  body: string;
  containsSpoilers: boolean;
  createdAt: string;
  reactionCounts: Record<ReactionKind, number>;
  commentCount: number;
}

export interface CommunityComment {
  id: string;
  postId: string;
  authorId: string;
  authorHandle: string;
  body: string;
  containsSpoilers: boolean;
  createdAt: string;
  parentCommentId?: string;
}

export type ReportReason = "SPAM" | "HARASSMENT" | "UNMARKED_SPOILER" | "MISINFORMATION" | "OTHER";

export interface Report {
  id: string;
  reporterId: string;
  targetType: "post" | "comment";
  targetId: string;
  reason: ReportReason;
  details?: string;
  createdAt: string;
  status: "OPEN" | "ACTIONED" | "DISMISSED";
}
