import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import Bets from "./pages/Bets";
import Profile from "./pages/Profile";
import SignIn from "./pages/Sign-in";

function App() {
  return (
    <BrowserRouter>
      <Routes>

        {/* Base layout */}
        <Route path="/" element={<Layout />}>

          {/* Pages */}
          <Route index element={<Home />} />
          <Route path="bets" element={<Bets />} />
          <Route path="profile" element={<Profile />} />
          <Route path="sign-in" element={<SignIn />} />

        </Route>

      </Routes>
    </BrowserRouter>
  );
}

export default App;