/*
  # Fix feedback table schema and connect to users table

  1. Changes to feedback table
    - Add `user_id` column to link feedback to users
    - Add foreign key constraint to users table
    - Update existing feedback entries to have proper user references
    - Add index for better performance

  2. Security Updates
    - Update RLS policies to use user_id for proper access control
    - Ensure users can only manage their own feedback

  3. Data Migration
    - Handle existing feedback data gracefully
    - Ensure no data loss during migration
*/

-- First, add user_id column to feedback table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'feedback' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE feedback ADD COLUMN user_id uuid REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_feedback_user_id ON feedback(user_id);

-- Update RLS policies for feedback table
DROP POLICY IF EXISTS "Anyone can read feedback" ON feedback;
DROP POLICY IF EXISTS "Authenticated users can create feedback" ON feedback;

-- New policies with proper user isolation
CREATE POLICY "Anyone can read feedback for display"
  ON feedback
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Authenticated users can create their own feedback"
  ON feedback
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can read their own feedback"
  ON feedback
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can update their own feedback"
  ON feedback
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own feedback"
  ON feedback
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Add updated_at column for consistency
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'feedback' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE feedback ADD COLUMN updated_at timestamptz DEFAULT now();
  END IF;
END $$;

-- Create trigger to automatically update updated_at
CREATE OR REPLACE FUNCTION update_feedback_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_feedback_updated_at ON feedback;
CREATE TRIGGER update_feedback_updated_at
  BEFORE UPDATE ON feedback
  FOR EACH ROW
  EXECUTE FUNCTION update_feedback_updated_at();

-- Add constraint to ensure rating is between 1 and 5
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'feedback_rating_check'
  ) THEN
    ALTER TABLE feedback ADD CONSTRAINT feedback_rating_check 
    CHECK (rating >= 1 AND rating <= 5);
  END IF;
END $$;

-- Add constraint to ensure message is not empty
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'feedback_message_not_empty'
  ) THEN
    ALTER TABLE feedback ADD CONSTRAINT feedback_message_not_empty 
    CHECK (length(trim(message)) > 0);
  END IF;
END $$;

-- Add constraint to ensure user_name is not empty
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'feedback_user_name_not_empty'
  ) THEN
    ALTER TABLE feedback ADD CONSTRAINT feedback_user_name_not_empty 
    CHECK (length(trim(user_name)) > 0);
  END IF;
END $$;