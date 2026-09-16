export type AuthStackParamList = {
  Login: undefined;
  Signup: undefined;
};

export type HomeStackParamList = {
  Home: undefined;
  TitleDetail: { titleId: string };
  AskSlate: { titleId?: string } | undefined;
  ProUpgrade: { trigger?: string } | undefined;
  NewPost: { titleId: string };
  PostDetail: { postId: string };
  Notifications: undefined;
};

export type SearchStackParamList = {
  Search: undefined;
  TitleDetail: { titleId: string };
  NewPost: { titleId: string };
  PostDetail: { postId: string };
  AskSlate: { titleId?: string } | undefined;
  ProUpgrade: { trigger?: string } | undefined;
};

export type WatchlistStackParamList = {
  Watchlist: undefined;
  TitleDetail: { titleId: string };
  NewPost: { titleId: string };
  PostDetail: { postId: string };
  AskSlate: { titleId?: string } | undefined;
  ProUpgrade: { trigger?: string } | undefined;
};

export type ProfileStackParamList = {
  Profile: undefined;
  ProUpgrade: { trigger?: string } | undefined;
  Settings: undefined;
};

export type MySlateStackParamList = {
  MySlate: undefined;
  TitleDetail: { titleId: string };
  AskSlate: { titleId?: string } | undefined;
  ProUpgrade: { trigger?: string } | undefined;
  // TitleDetail offers "+ New post" and opens community posts, so every stack
  // that can reach TitleDetail must be able to reach these too — otherwise
  // those taps hit a navigator that has never heard of the route.
  NewPost: { titleId: string };
  PostDetail: { postId: string };
};

export type MainTabParamList = {
  HomeTab: undefined;
  MySlateTab: undefined;
  SearchTab: undefined;
  WatchlistTab: undefined;
  ProfileTab: undefined;
};
