import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// Google sign-in with stateless JWT sessions — no DB adapter needed. Each user is
// identified by their (lowercased) Google email, which scopes their collection.
export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [Google],
  session: { strategy: "jwt" },
  pages: { signIn: "/" },
});
