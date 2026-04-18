import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import Bets from "./pages/Bets";
import Profile from "./pages/Profile";
import SignIn from "./pages/Sign-in";
import { AuthProvider } from "./lib/AuthContext";
import { DevModeProvider } from "./lib/DevModeProvider";

function App() {
  return (
    <DevModeProvider>
      <AuthProvider>
        <BrowserRouter basename="/app">
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="bets" element={<Bets />} />
              <Route path="profile" element={<Profile />} />
              <Route path="sign-in" element={<SignIn />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </DevModeProvider>
  );
}

export default App;
