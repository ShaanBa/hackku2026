import './Sign-in.css'

function SignIn() {
    return (
        <div style={{display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh"}}>
            <h1>Welcome!</h1>

            <input
                type="text"
                placeholder="Username"
                style={{margin: "10px", padding: "10px", width: "300px"}}
            />

            <input
                type="text"
                placeholder="Password"
                style={{margin: "10px", padding: "10px", width: "300px"}}
            />

            <button style={{marginTop: "10px", padding: "10px 30px"}}>
                Sign in
            </button>

        </div>
    );
}

export default SignIn;