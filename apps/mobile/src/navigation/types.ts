export type AuthStackParamList = {
  Login: undefined;
  Signup: undefined;
};

export type HomeStackParamList = {
  Home: undefined;
  TitleDetail: { titleId: string };
  AskSlate: { titleId?: string } | undefined;
  ProUpgrade: undefined;
};

export type SearchStackParamList = {
  Search: undefined;
  TitleDetail: { titleId: string };
};

export type WatchlistStackParamList = {
  Watchlist: undefined;
  TitleDetail: { titleId: string };
};

export type ProfileStackParamList = {
  Profile: undefined;
  ProUpgrade: undefined;
};

export type MainTabParamList = {
  HomeTab: undefined;
  SearchTab: undefined;
  WatchlistTab: undefined;
  ProfileTab: undefined;
};
