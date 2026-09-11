export type ReactionKind = "hype" | "love" | "mindblown" | "laugh" | "skeptical";

export type PostKind = "discussion" | "prediction" | "theory" | "review";

export interface CommunityPost {
  id: string;
  authorId: string;
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
  body: string;
  containsSpoilers: boolean;
  createdAt: string;
  parentCommentId?: string;
}

export type ReportReason = "spam" | "harassment" | "unmarked_spoiler" | "misinformation" | "other";

export interface Report {
  id: string;
  reporterId: string;
  targetType: "post" | "comment";
  targetId: string;
  reason: ReportReason;
  details?: string;
  createdAt: string;
  status: "open" | "actioned" | "dismissed";
}
