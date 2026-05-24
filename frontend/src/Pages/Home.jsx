import { useState } from "react"
import API from "../Services/api"

function Home() {

  const [symptoms, setSymptoms] = useState("")
  const [result, setResult] = useState([])

  const predictDisease = async () => {

    try {

      const symptomsArray = symptoms
        .split(",")
        .map((item) => item.trim())

      const response = await API.post(
        "/predict-disease",
        {
          symptoms: symptomsArray
        }
      )

      console.log(response.data)

      setResult(response.data.predictions)

    } catch (error) {

      console.log(error)

      if (error.response) {
        console.log(error.response.data)
      }

      alert("Error predicting disease")
    }
  }

  return (

    <div
      style={{
        padding: "40px",
        fontFamily: "Arial",
        color: "white"
      }}
    >

      <h1>Medical AI Assistant</h1>

      <input
        type="text"
        placeholder="Enter symptoms separated by commas"
        value={symptoms}
        onChange={(e) =>
          setSymptoms(e.target.value)
        }
        style={{
          width: "400px",
          padding: "10px",
          marginTop: "20px"
        }}
      />

      <br /><br />

      <button
        onClick={predictDisease}
        style={{
          padding: "10px 20px",
          cursor: "pointer"
        }}
      >
        Predict Disease
      </button>

      <div style={{ marginTop: "30px" }}>

        <h2>Predictions:</h2>

        {
          result.length > 0 ? (

            result.map((item, index) => (

              <div key={index}>
                <h3>
                  {item.disease} - {item.confidence}%
                </h3>
              </div>

            ))

          ) : (

            <p>No prediction yet</p>

          )
        }

      </div>

    </div>
  )
}

export default Home