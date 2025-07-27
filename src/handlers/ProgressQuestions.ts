import { Socket } from 'socket.io';
import { Server as SocketIOServer } from 'socket.io';
import { Pool } from 'mysql2/promise';
import { Player, ProgressData, ReturnData } from '../types';
import { SanitizeData } from '../utils/SanitizeData';
import { PullPlayerData } from '../utils/PullPlayerData';
import { PullRoomData } from '../utils/PullRoomData';

export async function ProgressQuestions(
    socket: Socket, 
    progressData: ProgressData, 
    pool: Pool, 
    allPlayers: Player[], 
    io: SocketIOServer
): Promise<void> {
    const returnData: ReturnData = {success: false};
    const requiredData = ["playerKey", "playerSecret", "roomCode"];

    // Read and clean input
    const sanitizedData = await SanitizeData(progressData, requiredData, pool);
    if(sanitizedData.clean === false) {
        returnData.error = "SanitizeData failed while progressing question. " + sanitizedData.error;
        socket.emit('questions progressed', JSON.stringify(returnData));
        return;
    }

    if (!sanitizedData.playerKey || !sanitizedData.playerSecret || !sanitizedData.roomCode) {
        returnData.error = "Missing playerKey, playerSecret, or roomCode after sanitization.";
        socket.emit('questions progressed', JSON.stringify(returnData));
        return;
    }

    const roomCode = sanitizedData.roomCode;

    // Find the index (i.e. play order) of the current player
    let [currentPlayerIndexResult] = await pool.query(`SELECT current_player FROM room WHERE room_code = '${roomCode}';`);
    if (!currentPlayerIndexResult || (currentPlayerIndexResult as any).length == 0){
        returnData.error = "Couldn't pull current player while progressing question.";
        socket.emit('questions progressed', JSON.stringify(returnData));
        return;
    }
    let currentPlayerIndex = (currentPlayerIndexResult as any)[0].current_player; // 3

    // Find the index (i.e. play order) of everyone currently in the room, and sort the list
    let [playerIndexesResult] = await pool.query(`SELECT player_index FROM player WHERE room_code = '${roomCode}' AND active = TRUE;`);
    if (!playerIndexesResult || (playerIndexesResult as any).length == 0){
        returnData.error = "Couldn't pull current player indexs while progressing question.";
        socket.emit('questions progressed', JSON.stringify(returnData));
        return;
    }
    let playerIndexes = (playerIndexesResult as any).map((player: any) => player.player_index); // [1, 3, 2]
    playerIndexes.sort((a: number, b: number) => a - b); // [1, 2, 3]


    // Find the index of the current player, move one up in the list of indexes (wrap around if needed)
    const nextPlayerIndex = playerIndexes[(playerIndexes.findIndex((playerIndex: number) => currentPlayerIndex == playerIndex)+1)%playerIndexes.length];
    returnData.currentPlayerIndex = nextPlayerIndex;


    // Pull a new random card (not the one we just had)
    const [cardResult] = await pool.query(`SELECT * FROM card WHERE card_key != (SELECT card_key FROM room WHERE room_code = '${roomCode}') AND card_key != 8 AND card_key != 11 AND card_key != 12 ORDER BY RAND() LIMIT 1`);
    if (!cardResult || (cardResult as any).length == 0){
        returnData.error = "Couldn't pull new card while progressing question.";
        socket.emit('questions progressed', JSON.stringify(returnData));
        return;
    }
    const randomCard = (cardResult as any)[0];
    returnData.card = randomCard;


    // Pull all the questions from the card then select a random one
    const [questionsResult] = await pool.query(`SELECT * FROM question WHERE card_key = ${randomCard.card_key};`);
    if (!questionsResult || (questionsResult as any).length == 0) {
        returnData.error = "Couldn't pull questions while progressing question.";
        socket.emit('questions progressed', JSON.stringify(returnData));
        return;
    }
    returnData.questions = questionsResult as any;
    const randomQuestion = Math.floor(Math.random() * (questionsResult as any).length)+1;
    returnData.questionIndex = randomQuestion;


    // Update the room with the selected card and question, set the question as not revealed, then put everyone's guess back to -1
    if (!await pool.query(`UPDATE room SET question_revealed = false, card_key = ${randomCard.card_key}, question_index = ${randomQuestion}, current_player = ${nextPlayerIndex} WHERE room_code='${roomCode}';`)) { returnData.error = "Couldn't update room with card and new actor data while progressing question."; socket.emit('questions progressed', JSON.stringify(returnData)); return; }
    if (!await pool.query(`UPDATE player SET choice = NULL WHERE room_code='${roomCode}';`)) { returnData.error = "Couldn't unset player answers while progressing question."; socket.emit('questions progressed', JSON.stringify(returnData)); return; }


    // Pull the player list to send back
    const playerList = await PullPlayerData(roomCode, pool);
    if (!playerList || playerList.length == 0) { returnData.error = "Couldn't pull player list while progressing question."; socket.emit('questions progressed', JSON.stringify(returnData)); return; }
    playerList.forEach(player => { delete player.playerSecret; });
    returnData.playerList = playerList;


    // Pull room data to send back
    const roomData = await PullRoomData(roomCode, pool);
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