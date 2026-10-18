"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useContext, type ComponentProps } from "react";
import { BuyerTabPrefetch } from "@/components/buyer-tab-navigation";
import { isBuyerCachedPage } from "@/lib/buyer-navigation";

type Props = Omit<ComponentProps<typeof Link>, "href" | "prefetch"> & { href: string };

/** Let Next preload eligible visible links; retain native navigation and events. */
export function BuyerFlowLink({ href, ...props }: Props) {
  const enabled = useContext(BuyerTabPrefetch);
  const pathname = usePathname();
  return <Link {...props} href={href}
    prefetch={isBuyerCachedPage(href) ? enabled && href !== pathname : undefined} />;
}
