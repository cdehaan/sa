import { Socket } from 'socket.io';
import { Server as SocketIOServer } from 'socket.io';
import { Pool } from 'mysql2/promise';
import { Player, StartData, ReturnData } from '../types';
import { SanitizeData } from '../utils/SanitizeData';
import { PullPlayerData } from '../utils/PullPlayerData';
import { PullRoomData } from '../utils/PullRoomData';

export async function StartGame(
    socket: Socket, 
    startData: StartData, 
    pool: Pool, 
    allPlayers: Player[], 
    io: SocketIOServer
): Promise<void> {
    const returnData: ReturnData = {success: false};
    const requiredData = ["roomCode", "playerKey", "playerSecret"];

    const sanitizedData = await SanitizeData(startData, requiredData, pool);
    if(sanitizedData.clean === false) {
        returnData.error = "SanitizeData failed when reconnecting player. " + sanitizedData.error;
        socket.emit('game started', JSON.stringify(returnData));
        return;
    }

    if (!sanitizedData.roomCode || !sanitizedData.playerKey || !sanitizedData.playerSecret) {
        returnData.error = "Missing roomCode, playerKey, or playerSecret after sanitization.";
        socket.emit('game started', JSON.stringify(returnData));
        return;
    }

    const roomCode = sanitizedData.roomCode;
    const playerKey = sanitizedData.playerKey;
    const playerSecret = sanitizedData.playerSecret;
    

    // If this game has already been started, just ignore the event. Don't even reply, it's already done. (Still send database errors, though.)
    const [roomResult] = await pool.query(`SELECT card_key AS cardKey FROM room WHERE room_code = '${roomCode}';`);
    if (!roomResult) {
        returnData.error = "Couldn't check game card key when starting game.";
        socket.emit('game started', JSON.stringify(returnData));
        return;
    }
    if ((roomResult as any).length == 0) {
        returnData.error = "Couldn't find room code when starting game.";
        socket.emit('game started', JSON.stringify(returnData));
        return;
    }
    if ((roomResult as any)[0].cardKey != -1) { return; } // Game has already started. Can happen if 2 people tap "Start game" at the same time. Ignore this.


    // Pull the player list to verify the sender is in the room, and also to send back
    const playerList = await PullPlayerData(roomCode, pool);
    if (!playerList || playerList.length == 0) {
        returnData.error = "Couldn't pull player list while starting game.";
        socket.emit('game started', JSON.stringify(returnData));
        return;
    }
    if(!playerList.find(player => player.playerKey === playerKey && player.playerSecret === playerSecret)) {
        returnData.error = "Couldn't find player in room requested to start.";
        socket.emit('game started', JSON.stringify(returnData));
        return;
    }
    playerList.forEach(player => { delete player.playerSecret; });
    returnData.playerList = playerList;
    

    // Find the lowest index any player has, this will be the curent player in the room. (Usually 1, but if the game creator left the lobby, it might be higher.)
    const [minIndexResult] = await pool.query(`SELECT MIN(player_index) AS currentPlayerIndex FROM player WHERE room_code='${roomCode}' AND active IS TRUE;`);
    if (!minIndexResult || (minIndexResult as any).length === 0) {
        returnData.error = "No players found in the room when starting game.";
        socket.emit('game started', JSON.stringify(returnData));
        return;
    }
    const currentPlayerIndex = (minIndexResult as any)[0].currentPlayerIndex;


    // Pick a good random card for the first round of the game
    const [cardResult] = await pool.query("SELECT * FROM card WHERE card_key != 8 AND card_key != 11 AND card_key != 12 ORDER BY RAND() LIMIT 1;");
    if (!cardResult) {
        returnData.error = "Couldn't pick a random card when starting game.";
        socket.emit('game started', JSON.stringify(returnData));
        return;
    }
    const randomCard = (cardResult as any)[0];
    const cardKey = randomCard.card_key;
    returnData.card = randomCard;


    // Pull all questions on the card we picked
    const [questionsResult] = await pool.query(`SELECT * FROM question WHERE card_key = ${cardKey};`);
    if (!questionsResult) {
        returnData.error = "Couldn't pull card questions when starting game.";
        socket.emit('game started', JSON.stringify(returnData));
        return;
    }
    returnData.questions = questionsResult as any;


    // Pick a random answer, then save the current player, card, and question answer in the room
    const randomQuestion = Math.floor(Math.random() * (questionsResult as any).length)+1;
    if (!await pool.query(`UPDATE room SET current_player = ${currentPlayerIndex}, card_key = ${cardKey}, question_index = ${randomQuestion} WHERE room_code='${roomCode}';`)) {
        returnData.error = "Couldn't set the curent player, card key, or question answer for the room when starting game."; socket.emit('game started', JSON.stringify(returnData));
        return;
    }


    // Pull room data, which we've been updating
    const roomData = await PullRoomData(roomCode, pool);
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