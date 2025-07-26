require('dotenv').config();
import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import mysql from 'mysql2/promise';
import { 
    Player, 
    RequestData, 
    JoinData, 
    RejoinData, 
    LeaveData, 
    StartData, 
    GuessData, 
    RevealData, 
    ProgressData 
} from './types';

// Import functions that will be moved to separate files
import { GenerateGame } from './handlers/GenerateGame';
import { JoinGame } from './handlers/JoinGame';
import { RejoinGame } from './handlers/RejoinGame';
import { LeaveGame } from './handlers/LeaveGame';
import { StartGame } from './handlers/StartGame';
import { RegisterGuess } from './handlers/RegisterGuess';
import { RevealAnswer } from './handlers/RevealAnswer';
import { ProgressQuestions } from './handlers/ProgressQuestions';
import { RemovePlayer } from './handlers/RemovePlayer';

const app: express.Application = express();
const http = createServer(app);
const io = new SocketIOServer(http, {pingTimeout: 60000});

app.use(express.static('public'));
app.get('/', (req, res) => { res.sendFile(__dirname + '/index.html'); });
http.listen(3080, () => { console.log('listening on *:3080'); });

const pool = mysql.createPool({
    connectionLimit : 100,
    host: process.env.MYSQL_HOST!,
    user: process.env.MYSQL_USER!,
    password: process.env.MYSQL_ROOT_PASSWORD!,
    database: process.env.MYSQL_DATABASE!
});

const allPlayers: Player[] = []; // Array of: {socket, playerKey, playerSecret}s


io.on('connection', (socket: Socket) => {
    /*
    socket.on('event name', (sendData) => {
        // socket.emit('event name', data);               // back to sender
        // socket.to("room1").emit('event name', data);   // everyone in room except sender
        // io.in("room1").emit('event name', data);       // everyone in room
    });
    */

    socket.on('request game',       (requestData: RequestData) =>   { GenerateGame(socket, requestData, pool, allPlayers, io); });
    socket.on('join game',          (joinData: JoinData) =>         { JoinGame(socket, joinData, pool, allPlayers, io); });
    socket.on('rejoin game',        (rejoinData: RejoinData) =>     { RejoinGame(socket, rejoinData, pool, allPlayers, io); });
    socket.on('leave game',         (leaveData: LeaveData) =>       { LeaveGame(socket, leaveData, pool, allPlayers, io); });
    socket.on('start game',         (startData: StartData) =>       { StartGame(socket, startData, pool, allPlayers, io); });
    socket.on('send guess',         (guessData: GuessData) =>       { RegisterGuess(socket, guessData, pool, allPlayers, io); });
    socket.on('reveal answer',      (revealData: RevealData) =>     { RevealAnswer(socket, revealData, pool, allPlayers, io); });
    socket.on('progress questions', (progressData: ProgressData) => { ProgressQuestions(socket, progressData, pool, allPlayers, io); });
    socket.on('disconnect',         () =>                           { RemovePlayer(socket, pool, allPlayers, io); });
    socket.on('connect_error',      (err: Error) =>                 { console.log('Error connecting to server: ' + err); });
});

export { pool, allPlayers, io };