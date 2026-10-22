"use client";

import * as React from "react";
import {
  PlasmicNewPage,
  DefaultNewPageProps
} from "../../components/plasmic/strona_internetowa/PlasmicNewPage"; // plasmic-import: sxEayKxEjoph/render

export function ClientNewPage(props: DefaultNewPageProps) {
  return <PlasmicNewPage {...props} />;
}
