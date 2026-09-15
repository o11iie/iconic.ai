import type { LinkingOptions } from "@react-navigation/native";
import type { MainTabParamList } from "./types";

/**
 * Deep-link routing for the `slate://` scheme declared in app.json.
 *
 * Without this, the Android manifest advertises intent filters the app
 * never handles — a `slate://title/movie:27205` link would open Slate on
 * whatever screen it was last on, which is worse than not claiming the
 * link at all. Release notifications carry a titleId and community replies
 * carry a postId, so both need a destination.
 *
 * Only the custom scheme is claimed, never an https:// host: an App Link
 * would require a verified assetlinks.json on Slate's domain, and claiming
 * one without it produces links Android refuses to open.
 *
 * The two routes below are exactly the two hosts declared in app.json's
 * intentFilters (`title` and `post`). Adding a route here without adding
 * the matching intent filter would produce a link Android never delivers.
 */
export const linking: LinkingOptions<MainTabParamList> = {
  prefixes: ["slate://"],
  config: {
    screens: {
      HomeTab: {
        screens: {
          // slate://title/movie:27205
          TitleDetail: "title/:titleId",
          // slate://post/<postId>
          PostDetail: "post/:postId",
        },
      },
    },
  },
};
