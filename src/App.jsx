import React, { useEffect, useState } from "react";
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react'

/*
Sudoku (single-file React app)
Features implemented:
- Menu with Start / Exit
- Difficulty selection: Easy, Medium, Hard, Extreme
- 9-number buttons, Undo, Erase, Pencil
- Pencil mode (notes as small numbers in cell)
- Erase removes both notes and pen entries
- Undo reverts previous local action
- Input validation: prevents entries that break Sudoku rules

This version has ALL peer-to-peer / WebRTC code removed — it's a local-only Sudoku app.
*/

// --- Sudoku utilities ---

function range(n) {
  return Array.from({ length: n }, (_, i) => i);
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// Check if placing 'val' at (r,c) is valid in board (0 = empty)
function isValidPlacement(board, r, c, val) {
  if (val === 0) return true;
  // row
  for (let j = 0; j < 9; j++) if (board[r][j] === val && j !== c) return false;
  // col
  for (let i = 0; i < 9; i++) if (board[i][c] === val && i !== r) return false;
  // box
  const br = Math.floor(r / 3) * 3;
  const bc = Math.floor(c / 3) * 3;
  for (let i = br; i < br + 3; i++) for (let j = bc; j < bc + 3; j++) if (!(i === r && j === c) && board[i][j] === val) return false;
  return true;
}

// Solve using backtracking (used for generator)
function solve(board) {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (board[r][c] === 0) {
        for (let v = 1; v <= 9; v++) {
          if (isValidPlacement(board, r, c, v)) {
            board[r][c] = v;
            if (solve(board)) return true;
            board[r][c] = 0;
          }
        }
        return false;
      }
    }
  }
  return true;
}

// Is victory achieved
function isVictory(board) {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (board[r][c] === 0) {
        return false;
      }
    }
  }
  return true;
}

// Generate a full valid board
function generateFullBoard() {
  const board = Array.from({ length: 9 }, () => Array(9).fill(0));
  const nums = [1,2,3,4,5,6,7,8,9];
  function shuffle(a){
    for(let i=a.length-1;i>0;i--){
      const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];
    }
  }
  // Fill diagonal boxes randomly to speed up generation
  for (let k = 0; k < 9; k += 3) {
    const boxNums = [...nums]; shuffle(boxNums);
    let idx = 0;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) board[k + i][k + j] = boxNums[idx++];
  }
  // solve the rest
  solve(board);
  return board;
}

// Remove cells based on difficulty
function makePuzzle(full, difficulty) {
  const puzzle = deepClone(full);
  let removals;
  switch (difficulty) {
    case "Easy": removals = 35; break; // more clues
    case "Medium": removals = 45; break;
    case "Hard": removals = 52; break;
    case "Extreme": removals = 58; break;
    default: removals = 45;
  }
  const positions = [];
  for (let i = 0; i < 81; i++) positions.push(i);
  // shuffle
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1)); [positions[i], positions[j]] = [positions[j], positions[i]];
  }
  let removed = 0;
  for (let idx = 0; idx < positions.length && removed < removals; idx++) {
    const pos = positions[idx];
    const r = Math.floor(pos / 9), c = pos % 9;
    // temporary remove
    puzzle[r][c] = 0;
    removed++;
  }
  return puzzle;
}

// --- React component ---

export default function Sudoku() {
  
  const [victoryDialogOpen, setVictoryDialogOpen] = useState(false)
	 
  // UI states
  const [screen, setScreen] = useState("menu"); // menu | game
  const [difficulty, setDifficulty] = useState("Medium");

  // Game state
  const [given, setGiven] = useState(() => Array.from({length:9},()=>Array(9).fill(0)) ); // immutable clues
  const [board, setBoard] = useState(() => Array.from({length:9},()=>Array(9).fill(0))); // current pen entries (0 empty)
  const [pencil, setPencil] = useState(() => Array.from({length:9},()=>Array(9).fill([]))); // notes as arrays of numbers
  const [selected, setSelected] = useState([0,0]);
  const [pencilMode, setPencilMode] = useState(false);
  const [undoStack, setUndoStack] = useState([]);
  
  useEffect(() => {
    if (isVictory(board)) {
	  setVictoryDialogOpen(true);
	}
  }, [board]);

  // Helpers
  function pushUndo(action) {
    setUndoStack(s => { const n = [...s, action]; if (n.length > 200) n.shift(); return n; });
  }

  function applyLocalAction(action, pushToUndo = true) {
    // action types: setCell {r,c,val,mode:'pen'|'pencil'}; eraseCell {r,c}; setFullState {given,board,pencil}
    if (action.type === 'setCell') {
      const { r, c, val, mode } = action;
      // can't change given
      if (given[r][c] !== 0) return false;
	  // validate
      if (val !== 0 && !isValidPlacement(board, r, c, val)) return false;
      if (mode === 'pen') { 
        setBoard(b => {
          const nb = deepClone(b);
          nb[r][c] = val;
          return nb;
        });
        // pencil cleared when writing pen
        setPencil(p => {
          const np = deepClone(p);
          np[r][c] = [];
          return np;
        });
      } else {
        // pencil mode toggles a candidate in the cell
        setPencil(p => {
          const np = deepClone(p);
          const arr = new Set(np[r][c]);
          if (arr.has(val)) { arr.delete(val); } else { arr.add(val); }
          np[r][c] = Array.from(arr).sort((a,b)=>a-b);
          return np;
        });
      }
      if (pushToUndo) pushUndo(action);
    } else if (action.type === 'erase') {
      const { r, c } = action;
      if (given[r][c] !== 0) return false;
      setBoard(b => { const nb = deepClone(b); nb[r][c] = 0; return nb; });
      setPencil(p => { const np = deepClone(p); np[r][c] = []; return np; });
      if (pushToUndo) pushUndo(action);
    } else if (action.type === 'setFullState') {
      const { given: g, board: bo, pencil: pe } = action;
      setGiven(g);
      setBoard(bo);
      setPencil(pe);
      // clear undo stack (or could keep)
      setUndoStack([]);
    }
    return true;
  }

  function undo() {
    setUndoStack(s => {
      if (s.length === 0) return s;
      const last = s[s.length - 1];
      const rest = s.slice(0, s.length - 1);
      const a = last;
      if (a.type === 'setCell') {
        if (a.mode === 'pen') {
          if (a.prev !== undefined) {
            setBoard(b => { const nb = deepClone(b); nb[a.r][a.c] = a.prev; return nb; });
            setPencil(p => { const np = deepClone(p); np[a.r][a.c] = a.prevPencil || []; return np; });
          }
        } else {
          if (a.prevPencil !== undefined) {
            setPencil(p => { const np = deepClone(p); np[a.r][a.c] = a.prevPencil; return np; });
          }
        }
      } else if (a.type === 'erase') {
        if (a.prev !== undefined) {
          setBoard(b => { const nb = deepClone(b); nb[a.r][a.c] = a.prev; return nb; });
          setPencil(p => { const np = deepClone(p); np[a.r][a.c] = a.prevPencil || []; return np; });
        }
      }
      return rest;
    });
  }

  // When creating actions, we include prev snapshots for undo/revert
  function makeSetCellAction(r,c,val,mode){
    const prev = board[r][c];
    const prevPencil = pencil[r][c];
    return { type: 'setCell', r, c, val, mode, prev, prevPencil };
  }
  function makeEraseAction(r,c){
    const prev = board[r][c];
    const prevPencil = pencil[r][c];
    return { type: 'erase', r, c, prev, prevPencil };
  }

  // Game start
  function startGame(selectedDifficulty) {
    const full = generateFullBoard();
    const puzz = makePuzzle(full, selectedDifficulty);
    // set given, board, pencil reset
    const giv = deepClone(puzz);
    const bo = deepClone(puzz);
    // zeros remain as 0
    setGiven(giv);
    setBoard(bo);
    setPencil(Array.from({length:9},()=>Array.from({length:9},()=>[])));
    setUndoStack([]);
    setDifficulty(selectedDifficulty);
    setScreen('game');
	setPencilMode(false);
  }

  // Cell click handler
  function onCellClick(r,c) {
    setSelected([r,c]);
  }

  // Input a number (button press)
  function inputNumber(n) {
    const [r,c] = selected;
    if (given[r][c] !== 0) return;
    if (pencilMode) {
      const action = makeSetCellAction(r,c,n,'pencil');
      applyLocalAction(action, true);
    } else {
      // validate against current board (without this cell)
      const valid = isValidPlacement(board, r, c, n);
      if (!valid) {
        // invalid placement — do nothing
        return;
      }
      const action = makeSetCellAction(r,c,n,'pen');
      applyLocalAction(action, true);
    }
  }

  function onErase() {
    const [r,c] = selected;
    if (given[r][c] !== 0) return;
    const action = makeEraseAction(r,c);
    applyLocalAction(action, true);
  }

  // UI render
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
      <div className="max-w-4xl w-full">
        {screen === 'menu' && (
          <div className="bg-white p-6 rounded shadow">
            <h1 className="text-4xl text-center font-bold mb-6">Sudoku</h1>
            <div className="flex justify-center gap-3 mb-6">
              <button className="px-4 py-2 cursor-pointer bg-blue-600 hover:bg-blue-400 text-white rounded" onClick={() => { setScreen('choose'); }}>Start</button>
              <button className="px-4 py-2 cursor-pointer bg-red-500 hover:bg-red-300 text-white rounded" onClick={() => window.close?.() || alert('Exit — close the tab') }>Exit</button>
            </div>
          </div>
        )}

        {screen === 'choose' && (
          <div className="bg-white p-6 rounded shadow">
            <h2 className="text-4xl text-center font-semibold mb-6">Select difficulty</h2>
            <div className="flex flex-col md:flex-row flex-wrap content-center justify-center gap-3 mb-6">
              {['Easy','Medium','Hard','Extreme'].map(d => (
                <button key={d} className={`px-4 py-2 rounded cursor-pointer ${difficulty===d? 'bg-green-600 text-white' : 'bg-gray-200'}`} onClick={() => setDifficulty(d)}>{d}</button>
              ))}
            </div>
            <div className="flex justify-center gap-3">
              <button className="px-4 py-2 cursor-pointer bg-blue-600 hover:bg-blue-400 text-white rounded" onClick={() => startGame(difficulty)}>Play</button>
              <button className="px-4 py-2 cursor-pointer bg-gray-200 hover:bg-gray-300 rounded" onClick={() => setScreen('menu')}>Back</button>
            </div>
          </div>
        )}

        {screen === 'game' && (
          <div className="bg-white p-4 rounded shadow gap-4">
            <div className="flex justify-center">
              <div className="grid grid-cols-9 auto-rows-fr gap-0 border-2 border-black" style={{width: 'min(540px, 90vw)', aspectRatio: '1/1' }}>
                {range(9).map(r => range(9).map(c => {
				  const isGiven = given[r][c] !== 0;
				  const selVal = board[selected[0]][selected[1]] !== 0 ? board[selected[0]][selected[1]] : null;
				  const sameRow = r === selected[0];
				  const sameCol = c === selected[1];
				  const sameSquare = (~~(r / 3) == ~~(selected[0] / 3)) && (~~(c / 3) === ~~(selected[1] / 3));
				  const isSelected = sameRow && sameCol;
				  const val = board[r][c];
				  const notes = pencil[r][c] || [];
				  const sameVal = selVal && (val === selVal || notes.includes(selVal));
				  const highlight = selVal && (sameRow || sameCol || sameSquare);

				  // choose bg class once — порядок важен: selected > highlight > given > default
				  let bgClass = 'bg-white';
				  if (isSelected || sameVal) bgClass = 'bg-blue-100';
				  else if (highlight) bgClass = 'bg-gray-200';
				  else if (isGiven) bgClass = 'bg-gray-100';
				  
				  // now use only ONE bg-* class in the className:
				  return (
					<div
					  key={`${r}-${c}`}
					  onClick={() => onCellClick(r,c)}
					  className={`relative w-full h-full flex items-center justify-center cursor-pointer select-none ${bgClass} border ${((c+1)%3===0 && c!==8) ? 'border-r-2' : ''} ${((r+1)%3===0 && r!==8) ? 'border-b-2' : ''}`}
					>
					  {isGiven ? (
						<div className="text-xl font-bold">{given[r][c]}</div>
					  ) : (
						<>
						  {val !== 0 ? (
							<div className="text-xl text-sky-700 font-bold">{val}</div>
						  ) : (
							notes.length > 0 ? (
							  <div className="absolute text-xs grid grid-cols-3 auto-rows-fr w-full h-full p-1">
							    {range(9).map(i => (
								  <div key={i} className="relative w-full h-full flex items-center justify-center leading-3">{notes.includes(i+1) ? i+1 : ' '}</div>
								))}
							  </div>
							) : ''
						  )}
						</>
					  )}
					</div>
				  );
                }))}
              </div>
			  
            </div>
            <div className="flex justify-center gap-2 mt-3">
				<div className="bg-gray-50 p-3 rounded">
				  <div className="grid grid-cols-9 gap-2" style={{width: 'min(480px, 80vw)', aspectRatio: '10/1' }}>
				    {range(9).map(i => (
					  <button key={i} className="relative w-full h-full flex items-center justify-center cursor-pointer select-none bg-gray-200 hover:bg-gray-300 rounded" onClick={() => inputNumber(i+1)}>{i+1}</button>
					))}
				  </div>
				</div>
		      </div>
              <div className="flex justify-center gap-2 mt-3">
                <button className="cursor-pointer px-3 py-2 bg-gray-200 hover:bg-gray-300 rounded" onClick={() => { setPencilMode(m=>!m); }}>{pencilMode ? 'Pencil: ON' : 'Pencil: OFF'}</button>
                <button className="cursor-pointer px-3 py-2 bg-gray-200 hover:bg-gray-300 rounded" onClick={() => undo()}>Undo</button>
                <button className="cursor-pointer px-3 py-2 bg-gray-200 hover:bg-gray-300 rounded" onClick={() => onErase()}>Erase</button>
                <button className="cursor-pointer px-3 py-2 bg-gray-200 hover:bg-gray-300 rounded" onClick={() => { setScreen('menu'); }}>Exit to Menu</button>
              </div>
          </div>
        )}
      </div>
	  <Dialog open={victoryDialogOpen} onClose={setVictoryDialogOpen} className="relative z-10">
		  <DialogBackdrop
			transition
			className="fixed inset-0 bg-gray-500/75 transition-opacity data-closed:opacity-0 data-enter:duration-300 data-enter:ease-out data-leave:duration-200 data-leave:ease-in dark:bg-gray-900/50"
		  />

		  <div className="fixed inset-0 z-10 w-screen overflow-y-auto">
			<div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
			  <DialogPanel
				transition
				className="relative transform overflow-hidden rounded-lg bg-white text-left shadow-xl transition-all data-closed:translate-y-4 data-closed:opacity-0 data-enter:duration-300 data-enter:ease-out data-leave:duration-200 data-leave:ease-in sm:my-8 sm:w-full sm:max-w-lg data-closed:sm:translate-y-0 data-closed:sm:scale-95 dark:bg-gray-800 dark:outline dark:-outline-offset-1 dark:outline-white/10"
			  >
			    <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4 dark:bg-gray-800">
					<h1 className="text-6xl text-center font-bold mb-10">Victory!</h1>
					<div className="flex justify-center gap-2 mt-3">
					  <button className="cursor-pointer px-3 py-2 bg-gray-200 hover:bg-gray-300  rounded" onClick={() => { startGame(difficulty); setVictoryDialogOpen(false); }}>Play Again</button>
					  <button className="cursor-pointer px-3 py-2 bg-gray-200 hover:bg-gray-300 rounded" onClick={() => { setScreen('menu'); setVictoryDialogOpen(false); }}>Exit to Menu</button>
					</div>
				</div>
			  </DialogPanel>
			</div>
		  </div>
	  </Dialog>
    </div>

  );
}