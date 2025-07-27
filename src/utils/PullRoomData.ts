import { Pool } from 'mysql2/promise';
import { RoomData, Card, Question } from '../types';

// Pull the room's information, including the current questions if the game has started
export async function PullRoomData(roomCode: string, pool: Pool): Promise<RoomData | null | false> {
    const roomDataResult = await pool.query(`SELECT room_code AS roomCode, question_index AS roomCorrectAnswer, current_player AS roomCurrentPlayer, card_key AS roomCardKey, question_revealed AS roomQuestionRevealed, last_action FROM room WHERE room_code='${roomCode}';`);
    if (!roomDataResult)                { return false; } // Error searching
    if ((roomDataResult[0] as any).length === 0) { return null; }  // Found nothing
    const roomData = (roomDataResult[0] as any)[0] as RoomData;
    // e.g. roomData = { roomCode: "RNXCD", roomCorrectAnswer: 5, roomCurrentPlayer: 1, roomCardKey: 24, roomQuestionRevealed: 0, last_action: "2022-03-24 13:59:41", }


    // Deduce the game state based on other variables. Could be client-side.
    if      (roomData.roomCardKey == -1)         { roomData.roomGameState = 0; }
    else if (roomData.roomQuestionRevealed == 0) { roomData.roomGameState = 1; }
    else                                         { roomData.roomGameState = 2; }


    // Game has started, send back info about the current card
    if (roomData.roomGameState > 0) {
        const cardResult = await pool.query(`SELECT * FROM card WHERE card_key=${roomData.roomCardKey};`);
        if (!cardResult) { 
            return false;
        }
        roomData.roomCard = (cardResult[0] as any)[0] as Card;

        const questionsResult = await pool.query(`SELECT * FROM question WHERE card_key = ${roomData.roomCardKey};`);
        if (!questionsResult) {
            return false;
        }
        roomData.roomCard.questions = (questionsResult[0] as any) as Question[];
    }
    
    return roomData;
}