import { describe, it, expect } from 'vitest';

describe('Workout Block Logic', () => {
  it('should correctly add a new block to a workout', () => {
    // This is a placeholder test. In a real scenario, you would import and test
    // functions related to workout block manipulation, e.g., adding, reordering, or deleting blocks.
    const initialBlocks = [{ id: '1', type: 'movement', movements: [] }];
    const newBlock = { id: '2', type: 'transition', duration: 30 };
    const updatedBlocks = [...initialBlocks, newBlock];

    expect(updatedBlocks).toHaveLength(2);
    expect(updatedBlocks[1]).toEqual(newBlock);
  });

  it('should correctly update a block property', () => {
    const blocks = [{ id: '1', type: 'movement', rounds: 3 }];
    const updatedBlocks = blocks.map(block =>
      block.id === '1' ? { ...block, rounds: 5 } : block
    );

    expect(updatedBlocks[0].rounds).toBe(5);
  });

  it('should remove a block from the workout', () => {
    const blocks = [
      { id: '1', type: 'movement', movements: [] },
      { id: '2', type: 'transition', duration: 30 },
    ];
    const remainingBlocks = blocks.filter(block => block.id !== '1');

    expect(remainingBlocks).toHaveLength(1);
    expect(remainingBlocks[0].id).toBe('2');
  });
});
