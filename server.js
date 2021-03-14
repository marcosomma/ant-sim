const path = require('path')
const express = require('express')
const cors = require('cors')
const bodyParser = require('body-parser')

const app = express()
let options = {}

app.use(express.static(path.join(__dirname, 'dist'), options))
app.use(cors())
app.set('port', process.env.PORT || 8080)

const server = app.listen(app.get('port'), function (request, response) {
  console.log('Listening on port ', server.address().port)
})
