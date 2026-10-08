"use client";

import { LogIn, LogOut } from "lucide-react";
import { signInWithGoogle, signOutUser, type StudioCapabilities } from "@/app/actions";

const button =
  "flex items-center gap-2 rounded-lg border border-[#2a2a2a] bg-[#141414] px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-zinc-300 transition-colors hover:border-indigo-500 hover:text-white";

export default function AccountMenu({ auth }: { auth: StudioCapabilities["auth"] | undefined }) {
  if (!auth || !auth.configured) return null;

  if (!auth.user) {
    return (
      <form action={signInWithGoogle}>
        <button className={button}>
          <LogIn className="h-3.5 w-3.5" /> Se connecter
        </button>
      </form>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {auth.user.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={auth.user.image} alt="" referrerPolicy="no-referrer" className="h-7 w-7 rounded-full border border-[#2a2a2a]" />
      )}
      <span className="hidden max-w-[10rem] truncate text-xs text-zinc-400 md:inline" title={auth.user.email}>
        {auth.user.name ?? auth.user.email}
      </span>
      <form action={signOutUser}>
        <button className={button} aria-label="Se déconnecter">
          <LogOut className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Déconnexion</span>
        </button>
      </form>
    </div>
  );
}
