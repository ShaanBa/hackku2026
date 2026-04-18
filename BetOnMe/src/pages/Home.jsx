import "./Home.css";

function Home() {
  return (
    <div className="container">

      {/* LEFT SIDE */}
      <div className="left">

        <div className="box goal">
          <h2>Current Goal</h2>
          <p>Finish studying React fundamentals</p>
        </div>

        <div className="box week">
          <h3>Weekly View</h3>
          <p>Mon - Sun progress tracker goes here</p>
        </div>

      </div>

      {/* RIGHT SIDE */}
      <div className="right">

        <div className="box add">
          <h3>Add Goal</h3>
          <button>Add +</button>
        </div>

        <div className="box ratio">
          <h3>Completion Ratio</h3>
          <p>7 / 10 goals completed</p>
        </div>

      </div>

    </div>
  );
}

export default Home;