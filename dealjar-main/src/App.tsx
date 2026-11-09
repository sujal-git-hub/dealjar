import { useEffect } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useSearchParams } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Shell } from "@/components/Shell";
import { ToastProvider } from "@/components/toast";
import { AuthProvider, useAuth } from "@/lib/auth";
import { rememberReferral } from "@/lib/session";
import HomePage from "@/pages/Home";
import DealsPage from "@/pages/Deals";
import DealDetailPage from "@/pages/DealDetail";
import JarPage from "@/pages/JarPage";
import FundingPage from "@/pages/Funding";
import MePage from "@/pages/Me";
import SignInPage from "@/pages/SignIn";
import WelcomePage from "@/pages/Welcome";
import ProfileEditPage from "@/pages/ProfileEdit";
import { SponsorPage, UserPage } from "@/pages/Profiles";
import { DealFormPage, StudioPage } from "@/pages/Studio";
import ReceiptsPage from "@/pages/Receipts";
import AdminPage from "@/pages/Admin";

const client = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

const TITLES: Record<string, string> = { "": "DealJar: every deal fills a jar", deals: "Deals", jar: "My jar", funding: "Funding", me: "Me", signin: "Sign in", welcome: "Welcome", studio: "Studio", receipts: "Receipts", admin: "Admin", u: "Profile", s: "Sponsor" };

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    const t = TITLES[pathname.split("/")[1] ?? ""] ?? "DealJar";
    document.title = pathname === "/" ? t : `${t} · DealJar`;
  }, [pathname]);
  return null;
}

/**
 * Two small jobs that belong to the whole app: remember a friend's referral link (?ref=CODE) for when the visitor signs
 * up, and send anyone who is signed in but has no username yet to the one step that gives them one.
 */
function Gate({ children }: { children: React.ReactNode }) {
  const [params] = useSearchParams();
  const { me } = useAuth();
  const { pathname } = useLocation();
  const ref = params.get("ref");
  useEffect(() => {
    if (ref && /^JAR-[A-Z0-9]{6}$/i.test(ref)) rememberReferral(ref.toUpperCase());
  }, [ref]);
  if (me?.user?.needsUsername && !/^\/(welcome|signin)/.test(pathname)) return <Navigate to={`/welcome?next=${encodeURIComponent(pathname)}`} replace />;
  return <>{children}</>;
}

const NotFound = () => (
  <div className="wrap pt-10">
    <h1 className="display display-lg">
      That page isn't <span className="serif">here.</span>
    </h1>
    <Link to="/" className="btn btn-primary mt-6">
      Back home
    </Link>
  </div>
);

export default function App() {
  return (
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <ScrollTop />
            <Shell>
              <Gate>
                <Routes>
                  <Route path="/" element={<HomePage />} />
                  <Route path="/deals" element={<DealsPage />} />
                  <Route path="/deals/:id" element={<DealDetailPage />} />
                  <Route path="/jar" element={<JarPage />} />
                  <Route path="/funding" element={<FundingPage />} />
                  <Route path="/me" element={<MePage />} />
                  <Route path="/me/edit" element={<ProfileEditPage />} />
                  <Route path="/signin" element={<SignInPage />} />
                  <Route path="/welcome" element={<WelcomePage />} />
                  <Route path="/u/:username" element={<UserPage />} />
                  <Route path="/s/:handle" element={<SponsorPage />} />
                  <Route path="/studio" element={<StudioPage />} />
                  <Route path="/studio/deals/:id" element={<DealFormPage />} />
                  <Route path="/receipts" element={<ReceiptsPage />} />
                  <Route path="/admin" element={<AdminPage />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Gate>
            </Shell>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
