require('dotenv').config();
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {pingTimeout: 60000});

app.use(express.static('public'));
app.get('/', (req, res) => { res.sendFile(__dirname + '/index.html'); });
http.listen(3080, () => { console.log('listening on *:3080'); });

const mysql = require('mysql2/promise');
const pool = mysql.createPool({
    connectionLimit : 100,
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_ROOT_PASSWORD,
    database: process.env.MYSQL_DATABASE
});

const allPlayers = []; // Array of: {socket, playerKey, playerSecret}s


io.on('connection', (socket) => {
    /*
    socket.on('event name', (sendData) => {
        // socket.emit('event name', data);               // back to sender
        // socket.to("room1").emit('event name', data);   // everyone in room except sender
        // io.in("room1").emit('event name', data);       // everyone in room
    });
    */

    socket.on('request game',       (requestData) =>   { GenerateGame(socket, requestData); });
    socket.on('join game',          (joinData) =>      { JoinGame(socket, joinData); });
    socket.on('rejoin game',        (rejoinData) =>    { RejoinGame(socket, rejoinData); });
    socket.on('leave game',         (leaveData) =>     { LeaveGame(socket, leaveData); });
    socket.on('start game',         (startData) =>     { StartGame(socket, startData); });
    socket.on('send guess',         (guessData) =>     { RegisterGuess(socket, guessData); });
    socket.on('reveal answer',      (revealData) =>    { RevealAnswer(socket, revealData); });
    socket.on('progress questions', (progressData) =>  { ProgressQuestions(socket, progressData); });
    socket.on('disconnect',         () =>              { RemovePlayer(socket) });
    socket.on('connect_error',      (err) =>           { console.log('Error connecting to server: ' + err); });
});


async function GenerateGame(socket, requestData){
    const returnData = {success: false};
    const requiredData = ["playerName"];

    requestData = await SanitizeData(requestData, requiredData);
    if(requestData.clean === false) {
        returnData.error = "SanitizeData failed when creating room. " + requestData.error;
        socket.emit('game created', JSON.stringify(returnData));
        return;
    }
    const playerName = requestData.playerName.substring(0,12);
    const playerSecret = Math.random().toString(36).slice(2).replace(/[^0-9a-z]/gi, '');
    returnData.playerSecret = playerSecret;


    // Generate a random 5-letter string for the room code. If this code already exists, make another.
    let newRoomCode;
    while (true) {
        newRoomCode = "";
        for (let i=0; i < 5; i++) {newRoomCode += String.fromCharCode(Math.floor((Math.random() * 26) + 65));}
        const roomExistsResult = await pool.query(`SELECT count(*) AS roomCount FROM room WHERE room_code='${newRoomCode}';`);
        if (!roomExistsResult) {
            returnData.error = "Couldn't check for existing room code.";
            socket.emit('game created', JSON.stringify(returnData));
            return;
        }
        if (roomExistsResult[0][0].roomCount === 0) { break; }
    }


    // Create the room in the database then put the room creator into the room
    await pool.query(`INSERT INTO room (room_code, current_player) VALUES ('${newRoomCode}', 1);`);
    const insertPlayerResult = await pool.query(`INSERT INTO player (room_code, player_index, player_name, secret) VALUES ('${newRoomCode}', 1, '${playerName}', '${playerSecret}');`);
    const playerKey = insertPlayerResult[0].insertId;
    returnData.playerKey = playerKey;


    // Put the player's socket, key, and secret into the array of sockets/keys then join the room socket
    allPlayers.push({"socket":socket.id, "playerKey":playerKey, "playerSecret": playerSecret});
    socket.join(newRoomCode);


    // Create the room variable, to be returned
    returnData.roomData = {roomCode: newRoomCode, roomState: 0, playerIndex: 1};


    // Pull the player list (should be just 1 player at this point), hide the secret for consistency
    const playerDataResult = await PullPlayerData(newRoomCode);
    if (!playerDataResult || playerDataResult[0].length != 1) {
        returnData.error = "Couldn't pull player list while generating room.";
        socket.emit('game created', JSON.stringify(returnData));
        return;
    }
    const playerList = playerDataResult[0];
    returnData.playerList = playerList;

    returnData.success = true;
    socket.emit('game created', JSON.stringify(returnData));
}


async function JoinGame(socket, joinData) {
    const returnData = {success: false};
    const requiredData = ["playerName", "roomCode"];

    joinData = await SanitizeData(joinData, requiredData);
    if(joinData.clean === false) {
        returnData.error = "SanitizeData failed when creating room. " + joinData.error;
        socket.emit('game joined', JSON.stringify(returnData));
        return;
    }


    // Check for existing players, and pipe them to "rejoin" instead of "join"
    if(joinData.playerKey && joinData.playerSecret) {
        const existingPlayer = await FindExistingPlayer(joinData.playerKey, joinData.playerSecret);
        if (existingPlayer && existingPlayer[0].length > 0) {
            RejoinGame(socket, joinData);
            return;
        }
    }

    const playerName = joinData.playerName.substring(0,12);
    const roomCode   = joinData.roomCode.toUpperCase();
    socket.join(roomCode);


    // Pull info about the room, including game state (+ card and questions if they exist)
    const roomData = await PullRoomData(roomCode);
    if (!roomData) {
        if(roomData === false) { returnData.error = "Error searching for room to join."; }
        if(roomData === null)  { returnData.error = "Tried to join a non-existant room."; }
        socket.emit('game joined', JSON.stringify(returnData));
        return;
    }


    // Find the max index (i.e. order of play) for all players in the room (empty room = 0)
    let maxIndex = await pool.query(`SELECT MAX(player_index) AS MaxIndex FROM player WHERE room_code='${roomCode}';`);
    if (!maxIndex) {
        returnData.error = "Couldn't pull current max index joining room.";
        socket.emit('game joined', JSON.stringify(returnData));
        return;
    }
    maxIndex = parseInt(maxIndex[0][0].MaxIndex) || 0;


    // If the room index (i.e. current player) is the first player, just set the new player index to one plus the max index of all other players
    let joiningPlayerIndex;
    if (roomData.roomCurrentPlayer == "1") {
        joiningPlayerIndex = maxIndex + 1;
    }

    // If the current player isn't the first player, push up all upcoming player indexes, then slot the new player into the current slot, then progress room's index
    // If the room index was 10, make everyone 10 or above one larger, make the new player 10, and set the room to 11
    // Why? This means the new player will be the last player in line to be the actor
    else {
        if (!await pool.query(`UPDATE player SET player_index = player_index+1 WHERE player_index >= ${roomData.roomCurrentPlayer} AND room_code='${roomCode}';`)) {
            returnData.error = "Couldn't update other player indexes while joining room.";
            socket.emit('game joined', JSON.stringify(returnData));
            return;
        }
        if(!await pool.query(`UPDATE room SET current_player = current_player+1 WHERE room_code = '${roomCode}';`)) {
            returnData.error = "Couldn't update room index while joining room.";
            socket.emit('game joined', JSON.stringify(returnData));
            return;
        }
        joiningPlayerIndex = roomData.roomCurrentPlayer;
        roomData.roomCurrentPlayer++;
    }


    // Insert the player into the database, with a new secret
    const playerSecret = Math.random().toString(36).slice(2);
    const insertPlayerResult = await pool.query(`INSERT INTO player (room_code, player_index, player_name, secret) VALUES ('${roomCode}', ${joiningPlayerIndex}, '${playerName}', '${playerSecret}');`);
    if (!insertPlayerResult) {
        returnData.error = "Couldn't insert player into room while joining room."; socket.emit('game joined', JSON.stringify(returnData));
        return;
    }
    const playerKey = insertPlayerResult[0].insertId;
    returnData.playerKey = playerKey;  // So everyone know which player just joined, and new player knows their key

    console.log(playerName + " joined room " + roomCode);

    // Save the player's socket id, key, and secret
    allPlayers.push({"socket":socket.id, "playerKey":playerKey, "playerSecret": playerSecret});

    // Pull info about all players in the room
    const playerDataResult = await PullPlayerData(roomCode);
    if (!playerDataResult || playerDataResult[0].length == 0) { returnData.error = "Couldn't pull player list while joining room."; socket.emit('game joined', JSON.stringify(returnData)); return; }
    const playerList = playerDataResult[0];
    playerList.forEach(player => { delete player.playerSecret; });
    returnData.playerList = playerList;

    returnData.roomData = roomData;


    // Tell everyone else a player joined
    returnData.success = true;
    socket.broadcast.to(roomCode).emit('player joined',  JSON.stringify(returnData));


    // Tell player who joined (include their secret)
    returnData.playerSecret = playerSecret;
    socket.emit('game joined', JSON.stringify(returnData));
}


/**
 * Rejoins a game a player was previous in.
 *
 * @param {socket} socket The rejoining player's socket
 * @param {JSON} rejoinData Contains the player's key and secret (but not room code)
 * @return {void}
 */
async function RejoinGame(socket, rejoinData) {
    const returnData = {success: false};


    // Sanitize and verify input
    const requiredData = ["playerKey", "playerSecret"];
    rejoinData = await SanitizeData(rejoinData, requiredData);
    if(rejoinData.clean === false) {
        returnData.error = "SanitizeData failed when rejoining game. " + rejoinData.error;
        socket.emit('game rejoined', JSON.stringify(returnData));
        return;
    }

    const playerKey = rejoinData.playerKey;
    const playerSecret = rejoinData.playerSecret;
    returnData.playerKey = playerKey; // Tells current players which player rejoined


    // Update the player's new socket, or store all their data if they don't have an entry, then connect the socket to the room
    const playerEntry = allPlayers.find(player => { return player.playerKey === playerKey && player.playerSecret === playerSecret});
    if(playerEntry) {
        playerEntry.socket = socket.id;
    } else {
        allPlayers.push({"socket":socket.id, "playerKey":playerKey, "playerSecret": playerSecret});
    }


    // Pull the player's room code
    const roomCode = await PullRoomCode(playerKey, playerSecret);
    if(!roomCode) {
        returnData.error = "No roomcode results when looking up player key/secret pair for rejoining game.";
        socket.emit('game rejoined', JSON.stringify(returnData));
        return;
    }
    socket.join(roomCode);


    // Set the player as active, in case they were set as inactive
    if(!await pool.query(`UPDATE player SET active = TRUE WHERE player_key = ${playerKey};`)) {
        returnData.error = "Couldn't update to Active when rejoining room.";
        socket.emit('game rejoined', JSON.stringify(returnData));
        return;
    }


    // Pull info about all players in the room
    const playerDataResult = await PullPlayerData(roomCode);
    if (!playerDataResult || playerDataResult[0].length == 0) {
        returnData.error = "Couldn't pull player list while rejoining room.";
        socket.emit('game rejoined', JSON.stringify(returnData));
        return;
    }
    const playerList = playerDataResult[0];
    playerList.forEach(player => { delete player.playerSecret; });
    returnData.playerList = playerList;


    // Pull room data
    const roomData = await PullRoomData(roomCode);
    if (!roomData) {
        if(roomData === false) { returnData.error = "Error searching for room to rejoin."; }
        if(roomData === null)  { returnData.error = "Tried to rejoin a non-existant room."; }
        socket.emit('game rejoined', JSON.stringify(returnData));
        return;
    }


    returnData.roomData = roomData;
    returnData.success = true;

    // Tell everyone else a player (re)joined
    socket.to(roomCode).emit('player joined',  JSON.stringify(returnData));

    // Tell player who rejoined
    socket.emit('game rejoined', JSON.stringify(returnData));    
}


async function LeaveGame(socket, leaveData) {
    const returnData = {success: false};

    // Sanitize the leave data
    const requiredData = ["playerKey", "playerSecret"];
    leaveData = await SanitizeData(leaveData, requiredData);
    if(leaveData.clean === false) {
        returnData.error = "SanitizeData failed when leaving game. " + leaveData.error;
        socket.emit('game left', JSON.stringify(returnData));
        return;
    }
    const playerKey = parseInt(leaveData.playerKey);
    const playerSecret = leaveData.playerSecret;
    returnData.playerKey = playerKey; // So everyone knows who left

    const roomCode = await PullRoomCode(playerKey, playerSecret);
    if(!roomCode) {
        returnData.error = "Find player room as they left.";
        socket.emit('game left', JSON.stringify(returnData));
        return;
    }

    // Delete the player
    if (!await pool.query(`DELETE FROM player WHERE player_key = ${playerKey} AND secret = '${playerSecret}';`)) {
        returnData.error = "Couldn't delete player as they left.";
        socket.emit('game left', JSON.stringify(returnData));
        return;
    }


    // Pull fresh data and send to everyone else in the room
    const playerDataResult = await PullPlayerData(roomCode);
    if (!playerDataResult || playerDataResult[0].length == 0) {
        returnData.error = "Couldn't pull player list while reconnecting player.";
        socket.emit('game left', JSON.stringify(returnData));
        return;
    }
    const playerList = playerDataResult[0];
    playerList.forEach(player => { delete player.playerSecret; });
    returnData.playerList = playerList;


    // Tell the departing player they can leave
    returnData.success = true;
    socket.emit('game left', JSON.stringify(returnData));

    // Tell everyone else about the player that left
    socket.to(roomCode).emit('player left', JSON.stringify(returnData));
}

async function StartGame(socket, startData) {
    const returnData = {success: false};
    const requiredData = ["roomCode", "playerKey", "playerSecret"];

    startData = await SanitizeData(startData, requiredData);
    if(startData.clean === false) {
        returnData.error = "SanitizeData failed when reconnecting player. " + startData.error;
        socket.emit('game started', JSON.stringify(returnData));
        return;
    }
    const roomCode = startData.roomCode;
    const playerKey = startData.playerKey;
    const playerSecret = startData.playerSecret;
    

    // If this game has already been started, just ignore the event. Don't even reply, it's already done. (Still send database errors, though.)
    const roomResult = await pool.query(`SELECT card_key AS cardKey FROM room WHERE room_code = '${roomCode}';`);
    if (!roomResult) {
        returnData.error = "Couldn't check game card key when starting game.";
        socket.emit('game started', JSON.stringify(returnData));
        return;
    }
    if (roomResult[0].length == 0) {
        returnData.error = "Couldn't find room code when starting game.";
        socket.emit('game started', JSON.stringify(returnData));
        return;
    }
    if (roomResult[0][0].cardKey != -1) { return; } // Game has already started. Can happen if 2 people tap "Start game" at the same time. Ignore this.


    // Pull the player list to verify the sender is in the room, and also to send back
    const playerDataResult = await PullPlayerData(roomCode);
    if (!playerDataResult || playerDataResult[0].length == 0) {
        returnData.error = "Couldn't pull player list while starting game.";
        socket.emit('game started', JSON.stringify(returnData));
        return;
    }
    const playerList = playerDataResult[0];
    if(!playerList.find(player => player.playerKey === playerKey && player.playerSecret === playerSecret)) {
        returnData.error = "Couldn't find player in room requested to start.";
        socket.emit('game started', JSON.stringify(returnData));
        return;
    }
    playerList.forEach(player => { delete player.playerSecret; });
    returnData.playerList = playerList;
    

    // Find the lowest index any player has, this will be the curent player in the room. (Usually 1, but if the game creator left the lobby, it might be higher.)
    const minIndexResult =  await pool.query(`SELECT MIN(player_index) AS currentPlayerIndex FROM player WHERE room_code='${roomCode}' AND active IS TRUE;`);
    if (!minIndexResult || minIndexResult.length === 0) {
        returnData.error = "No players found in the room when starting game.";
        socket.emit('game started', JSON.stringify(returnData));
        return;
    }
    const currentPlayerIndex = minIndexResult[0][0].currentPlayerIndex;


    // Pick a good random card for the first round of the game
    const cardResult = await pool.query("SELECT * FROM card WHERE card_key != 8 AND card_key != 11 AND card_key != 12 ORDER BY RAND() LIMIT 1;");
    if (!cardResult) {
        returnData.error = "Couldn't pick a random card when starting game.";
        socket.emit('game started', JSON.stringify(returnData));
        return;
    }
    const randomCard = cardResult[0][0];
    const cardKey = randomCard.card_key;
    returnData.card = randomCard;


    // Pull all questions on the card we picked
    const questionsResult = await pool.query(`SELECT * FROM question WHERE card_key = ${cardKey};`);
    if (!questionsResult) {
        returnData.error = "Couldn't pull card questions when starting game.";
        socket.emit('game started', JSON.stringify(returnData));
        return;
    }
    returnData.questions = questionsResult[0];


    // Pick a random answer, then save the current player, card, and question answer in the room
    const randomQuestion = Math.floor(Math.random() * questionsResult[0].length)+1;
    if (!await pool.query(`UPDATE room SET current_player = ${currentPlayerIndex}, card_key = ${cardKey}, question_index = ${randomQuestion} WHERE room_code='${roomCode}';`)) {
        returnData.error = "Couldn't set the curent player, card key, or question answer for the room when starting game."; socket.emit('game started', JSON.stringify(returnData));
        return;
    }


    // Pull room data, which we've been updating
    const roomData = await PullRoomData(roomCode);
    if (!roomData) {
        if(roomData === false) { returnData.error = "Error searching for room to start."; }
        if(roomData === null)  { returnData.error = "Tried to start a non-existant room."; }
        socket.emit('game started', JSON.stringify(returnData));
        return;
    }
    returnData.roomData = roomData;


    // Tell everyone in the room to start the game
    returnData.success = true;
    io.in(roomCode).emit('game started',  JSON.stringify(returnData));
}


async function RemovePlayer(socket) {
    const returnData = {success: false};


    // Find the player based on the socket that closed
    const previousPlayer = allPlayers.find(player => { return player.socket === socket.id });
    if(previousPlayer === undefined) { return; } // A player not in our list is leaving, likely they never joined a game. No need to throw an error, can ignore safely.

    const playerKey = previousPlayer.playerKey;
    if (!playerKey) { return; } // A player without a key is leaving, likely they never joined a game. No need to throw an error, can ignore safely.
    returnData.playerKey = playerKey;


    // Set the player as inactive
    if (!await pool.query(`UPDATE player SET active = FALSE WHERE player_key= ${playerKey};`)) {
        returnData.error = "Couldn't set a player as inactive as they left.";
        socket.emit('player disconnected', JSON.stringify(returnData));
        return;
    }


    // Find what room the player was in
    const playerResult = await pool.query(`SELECT room_code as roomCode FROM player WHERE player_key = ${playerKey};`);
    if (!playerResult) {
        returnData.error = "Couldn't check room code key as someone left."; socket.emit('player disconnected', JSON.stringify(returnData));
        return;
    }
    if (playerResult[0].length == 0) { return; } // A player not in a room is leaving, can ignore safely.
    const roomCode = playerResult[0][0].roomCode;
    console.log(`Player key #${playerKey} is leaving room ${roomCode}`);


    // Pull the player list to send back
    const playerDataResult = await PullPlayerData(roomCode);
    if (!playerDataResult || playerDataResult[0].length == 0) {
        returnData.error = "Couldn't pull player list after a player left."; socket.emit('player disconnected', JSON.stringify(returnData));
        return;
    }
    const playerList = playerDataResult[0];
    playerList.forEach(player => { delete player.playerSecret; });
    returnData.playerList = playerList;


    // Tell everyone else in the room that the player left
    returnData.success = true;
    socket.to(roomCode).emit('player disconnected',  JSON.stringify(returnData));
}


async function RegisterGuess(socket, guessData) {
    const returnData = {success: false};
    const requiredData = ["playerKey", "playerSecret"];

    guessData = await SanitizeData(guessData, requiredData);
    if(guessData.clean === false) {
        returnData.error = "SanitizeData failed when registering player's guess. " + guessData.error;
        socket.emit('guess made', JSON.stringify(returnData));
        return;
    }

    const roomCode = guessData.roomCode;
    const playerKey = guessData.playerKey;
    const playerSecret = guessData.playerSecret;
    const questionIndex = guessData.questionIndex;

    // Register the guess
    if (!await pool.query(`UPDATE player SET choice= ${questionIndex} WHERE player_key= ${playerKey} AND secret = '${playerSecret}';`)) {
        returnData.error = "Couldn't registering player's guess.";
        socket.emit('guess made', JSON.stringify(returnData));
        return;
    }


    // Pull the player list to send back
    const playerDataResult = await PullPlayerData(roomCode);
    if (!playerDataResult || playerDataResult[0].length == 0) {
        returnData.error = "Couldn't pull player list while registering guess.";
        socket.emit('guess made', JSON.stringify(returnData));
        return;
    }
    const playerList = playerDataResult[0];
    playerList.forEach(player => { delete player.playerSecret; });
    returnData.playerList = playerList;

    // Tell everyone about the guess just registered
    returnData.success = true;
    io.in(roomCode).emit('guess made', JSON.stringify(returnData));
}


async function RevealAnswer(socket, revealData) {
    const returnData = {success: false};
    const requiredData = ["playerKey", "playerSecret", "roomCode"];

    revealData = await SanitizeData(revealData, requiredData);
    if(revealData.clean === false) {
        returnData.error = "SanitizeData failed while revealing answer. " + revealData.error;
        socket.emit('answer revealed', JSON.stringify(returnData));
        return;
    }
    const roomCode = revealData.roomCode;


    // Mark the answer as revealed
    if (!await pool.query(`UPDATE room SET question_revealed = true WHERE room_code='${roomCode}';`)) {
        returnData.error = "Couldn't set question as revealed.";
        socket.emit('answer revealed', JSON.stringify(returnData));
        return;
    }


    // Pull room data to see who's right
    const roomData = await PullRoomData(roomCode);
    if (!roomData) {
        if(roomData === false) { returnData.error = "Error searching for room to reveal answer."; }
        if(roomData === null)  { returnData.error = "Tried to reveal answer in a non-existant room."; }
        socket.emit('answer revealed', JSON.stringify(returnData));
        return;
    }
    returnData.roomData = roomData;
    const correctAnswer = roomData.roomCorrectAnswer;
    const currentPlayerIndex = roomData.roomCurrentPlayer;


    // Pull the player list to update
    const playerDataResult = await PullPlayerData(roomCode);
    if (!playerDataResult || playerDataResult[0].length == 0) {
        returnData.error = "Couldn't pull player list while revealing answer.";
        socket.emit('answer revealed', JSON.stringify(returnData));
        return;
    }
    const playerList = playerDataResult[0];
    playerList.forEach(player => { delete player.playerSecret; });

    // Count the number of players who guessed correctly
    const numberOfPlayersCorrect = playerList.reduce((accumulator, currentValue) => { return accumulator + ((currentValue.playerChoice==correctAnswer) ? 1 : 0); }, 0 );


    // forEach and await aren't good friends
    for (const player of playerList) {
        const playerKey = player.playerKey;

        // if actor, get a point for everyone correct
        if (player.playerIndex == currentPlayerIndex) {
            const updatedScore = (parseInt(player.playerScore) + numberOfPlayersCorrect);
            if (!await pool.query(`UPDATE player SET score = ${updatedScore} WHERE player_key = ${playerKey};`)) {
                returnData.error = "Couldn't update actor score while revealing answer.";
                socket.emit('answer revealed', JSON.stringify(returnData));
                return;
            }
            player.playerScore = updatedScore;
        }

        // if not actor and correct, get one point
        else if (player.playerChoice == correctAnswer) {
            const updatedScore = (parseInt(player.playerScore) + 1);
            if (!await pool.query(`UPDATE player SET score = ${updatedScore} WHERE player_key = ${playerKey};`)) {
                returnData.error = "Couldn't update player score while revealing answer.";
                socket.emit('answer revealed', JSON.stringify(returnData));
                return;
            }
            player.playerScore = updatedScore;
        }
    }
    returnData.playerList = playerList;


    // Tell everyone the answer was revealed
    returnData.success = true;
    io.in(roomCode).emit('answer revealed',  JSON.stringify(returnData));
}


async function ProgressQuestions(socket, progressData) {
    const returnData = {success: false};
    const requiredData = ["playerKey", "playerSecret", "roomCode"];

    // Read and clean input
    progressData = await SanitizeData(progressData, requiredData);
    if(progressData.clean === false) {
        returnData.error = "SanitizeData failed while progressing question. " + progressData.error;
        socket.emit('questions progressed', JSON.stringify(returnData));
        return;
    }
    const roomCode = progressData.roomCode;

    // Find the index (i.e. play order) of the current player
    let currentPlayerIndex = await pool.query(`SELECT current_player FROM room WHERE room_code = '${roomCode}';`);
    if (!currentPlayerIndex || currentPlayerIndex[0].length == 0){
        returnData.error = "Couldn't pull current player while progressing question.";
        socket.emit('questions progressed', JSON.stringify(returnData));
        return;
    }
    currentPlayerIndex = currentPlayerIndex[0][0].current_player; // 3

    // Find the index (i.e. play order) of everyone currently in the room, and sort the list
    let playerIndexes = await pool.query(`SELECT player_index FROM player WHERE room_code = '${roomCode}' AND active = TRUE;`);
    if (!playerIndexes || playerIndexes[0].length == 0){
        returnData.error = "Couldn't pull current player indexs while progressing question.";
        socket.emit('questions progressed', JSON.stringify(returnData));
        return;
    }
    playerIndexes = playerIndexes[0].map(player => player.player_index); // [1, 3, 2]
    playerIndexes.sort((a, b) => a - b); // [1, 2, 3]


    // Find the index of the current player, move one up in the list of indexes (wrap around if needed)
    const nextPlayerIndex = playerIndexes[(playerIndexes.findIndex(playerIndex => currentPlayerIndex == playerIndex)+1)%playerIndexes.length];
    returnData.currentPlayerIndex = nextPlayerIndex;


    // Pull a new random card (not the one we just had)
    const cardResult = await pool.query(`SELECT * FROM card WHERE card_key != (SELECT card_key FROM room WHERE room_code = '${roomCode}') AND card_key != 8 AND card_key != 11 AND card_key != 12 ORDER BY RAND() LIMIT 1`);
    if (!cardResult || cardResult[0].length == 0){
        returnData.error = "Couldn't pull new card while progressing question.";
        socket.emit('questions progressed', JSON.stringify(returnData));
        return;
    }
    const randomCard = cardResult[0][0];
    returnData.card = randomCard;


    // Pull all the questions from the card then select a random one
    const questionsResult = await pool.query(`SELECT * FROM question WHERE card_key = ${randomCard.card_key};`);
    if (!questionsResult || questionsResult[0].length == 0) {
        returnData.error = "Couldn't pull questions while progressing question.";
        socket.emit('questions progressed', JSON.stringify(returnData));
        return;
    }
    returnData.questions = questionsResult[0];
    const randomQuestion = Math.floor(Math.random() * questionsResult[0].length)+1;
    returnData.questionIndex = randomQuestion;


    // Update the room with the selected card and question, set the question as not revealed, then put everyone's guess back to -1
    if (!await pool.query(`UPDATE room SET question_revealed = false, card_key = ${randomCard.card_key}, question_index = ${randomQuestion}, current_player = ${nextPlayerIndex} WHERE room_code='${roomCode}';`)) { returnData.error = "Couldn't update room with card and new actor data while progressing question."; socket.emit('questions progressed', JSON.stringify(returnData)); return; }
    if (!await pool.query(`UPDATE player SET choice = NULL WHERE room_code='${roomCode}';`)) { returnData.error = "Couldn't unset player answers while progressing question."; socket.emit('questions progressed', JSON.stringify(returnData)); return; }


    // Pull the player list to send back
    const playerDataResult = await PullPlayerData(roomCode);
    if (!playerDataResult || playerDataResult[0].length == 0) { returnData.error = "Couldn't pull player list while progressing question."; socket.emit('questions progressed', JSON.stringify(returnData)); return; }
    const playerList = playerDataResult[0];
    playerList.forEach(player => { delete player.playerSecret; });
    returnData.playerList = playerList;


    // Pull room data to send back
    const roomData = await PullRoomData(roomCode);
    if (!roomData) {
        if(roomData === false) { returnData.error = "Error searching for room to progress."; }
        if(roomData === null)  { returnData.error = "Tried to progress a non-existant room."; }
        socket.emit('game started', JSON.stringify(returnData));
        return;
    }
    returnData.roomData = roomData;

    // Tell everyone to progress questions
    returnData.success = true;
    io.in(roomCode).emit('questions progressed',  JSON.stringify(returnData));
}


// Find the player's room code with the player's key and secret
async function PullRoomCode(playerKey, playerSecret) {
    const playerResult = await pool.query(`SELECT room_code as roomCode FROM player WHERE player_key = ${playerKey} AND secret = '${playerSecret}';`);
    if (!playerResult)               { return null; }
    if (playerResult[0].length == 0) { return null; }
    return playerResult[0][0].roomCode;
}


// Return an existing player with a given key and secret, if they exist
async function FindExistingPlayer(playerKey, playerSecret) {
    return await pool.query(`SELECT * from player WHERE player_key = ${playerKey} AND secret ='${playerSecret}'`);
}


// Pull data about all the players in the room
async function PullPlayerData(roomCode) {
    return await pool.query(`SELECT player_name AS playerName, player_index AS playerIndex, player_key AS playerKey, choice AS playerChoice, score AS playerScore, secret AS playerSecret, active FROM player WHERE room_code='${roomCode}' ORDER BY player_index;`);
}


// Pull the room's information, including the current questions if the game has started
async function PullRoomData(roomCode) {
    const roomDataResult = await pool.query(`SELECT room_code AS roomCode, question_index AS roomCorrectAnswer, current_player AS roomCurrentPlayer, card_key AS roomCardKey, question_revealed AS roomQuestionRevealed, last_action FROM room WHERE room_code='${roomCode}';`);
    if (!roomDataResult)                { return false; } // Error searching
    if (roomDataResult[0].length === 0) { return null; }  // Found nothing
    const roomData = roomDataResult[0][0];
    // e.g. roomData = { roomCode: "RNXCD", roomCorrectAnswer: 5, roomCurrentPlayer: 1, roomCardKey: 24, roomQuestionRevealed: 0, last_action: "2022-03-24 13:59:41", }


    // Deduce the game state based on other variables. Could be client-side.
    if      (roomData.roomCardKey == -1)         { roomData.roomGameState = 0; }
    else if (roomData.roomQuestionRevealed == 0) { roomData.roomGameState = 1; }
    else                                         { roomData.roomGameState = 2; }


    // Game has started, send back info about the current card
    if (roomData.roomGameState > 0) {
        const cardResult = await pool.query(`SELECT * FROM card WHERE card_key=${roomData.roomCardKey};`);
        if (!cardResult) { returnData.error = "Couldn't card info while joining room."; socket.emit('game joined', JSON.stringify(returnData)); return; }
        roomData.roomCard = cardResult[0][0];

        const questionsResult = await pool.query(`SELECT * FROM question WHERE card_key = ${roomData.roomCardKey};`);
        if (!questionsResult) {
            returnData.error = "Couldn't questions info while joining room."; socket.emit('game joined', JSON.stringify(returnData));
            return;
        }
        roomData.roomCard.questions = questionsResult[0];
    }
    
    return roomData;
}


// Check the types and content of data.
// If player key and secret are included, verify it's a real player
async function SanitizeData(dirtyData, requiredFields) {
    const cleanData = {clean: false};

    const allowedInputs = [
        {name: "playerName",    type: "string"},
        {name: "playerKey",     type: "number"},
        {name: "playerSecret",  type: "string"},
        {name: "roomCode",      type: "string"},
        {name: "questionIndex", type: "number"}
    ]

    for (const index in allowedInputs) {
        const inputName = allowedInputs[index].name;
        const inputType = allowedInputs[index].type;
        const data = dirtyData[inputName]

        // Null and undefined are fine, e.g.:
        // Register a guess => playerName is undefined
        // Undoing a guess => questionIndex is null
        if(data === undefined) { continue; }

        if(data === null) {
            cleanData[inputName] = null;
            continue;
        }

        // Return an error if there is data, but it's the wrong type
        if(typeof data !== inputType) {
            cleanData.error = `Malformed input ${inputName}, was type ${typeof data}`;
            return cleanData;
        }

        // Strip non alpha-numeric characters from strings, and max length of 20
        if(inputType === "string") {
            cleanData[inputName] = data.replace(/[^0-9a-z_ ]/gi, '').substr(0, 20);
        }

        // All keys are ints, for parse to int
        else if(inputType === "number") {
            cleanData[inputName] = parseInt(data);
        }
    }

    // If a field is required, but not found, return an error
    for (const field in requiredFields) {
        const fieldName = requiredFields[field];
        if(cleanData[fieldName] === undefined || cleanData[fieldName] === null) {
            cleanData.error = `Missing ${fieldName} data."`
            return cleanData;
        }
    }

    // If data contains a player key and player secret, validate it
    if(cleanData.playerKey && cleanData.playerSecret) {
        const verification = await VerifyPlayer({playerKey: cleanData.playerKey, playerSecret: cleanData.playerSecret, roomCode: cleanData.roomCode});
        if(verification.verified === false) {
            cleanData.error = "SanitizeData found player data that didn't validate. " + verification.error;
            return cleanData;
        }    
    }

    cleanData.clean = true;
    return cleanData;
}

async function VerifyPlayer(playerData) {
    const results = {verified: false};

    // Need a key and secret to verify
    if(playerData.playerKey === undefined || playerData.playerKey === null || playerData.playerSecret === undefined || playerData.playerSecret === null) {
        results.error = "Both player key and player secret required."
        return results;
    }

    // If the key or secret are not the right type of data, fail the test
    if(typeof playerData.playerKey !== "number" || typeof playerData.playerSecret !== "string") {
        results.error = "Player key or player secret malformed in player verification.";
        return results;
    }

    // This data exists and is the right type
    const playerKey = parseInt(playerData.playerKey);
    const playerSecret = playerData.playerSecret.replace(/[^0-9a-z]/gi, '').substr(0, 20);


    let query;
    // If a room code wasn't sent, just verifying the player key/secret pair is enough
    if(playerData.roomCode === undefined || playerData.roomCode === null) {
        query = `SELECT count(*) FROM player WHERE player_key = ${playerKey} AND secret = '${playerSecret}';`;
    }

    // If a room code was sent, make sure it's the right type, clean it, then add it into the query
    else {
        if(typeof playerData.roomCode !== "string") {
            results.error = "Room code malformed in player verification.";
            return results;
        }
        const roomCode = playerData.roomCode.replace(/[^0-9a-z]/gi, '').substr(0, 20);
        query = `SELECT count(*) FROM player WHERE player_key = ${playerKey} AND secret = '${playerSecret}' AND room_code = '${roomCode}';`;
    }
    
    // Run the query to find the player (or not)
    const playerEntry = await pool.query(query);
    if (!playerEntry || playerEntry[0].length === 0) {
        results.error = "Player not verified to exist."
        return results;
    }

    results.verified = true;
    return results;
}
