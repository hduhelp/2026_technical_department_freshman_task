export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      ai_calls: {
        Row: {
          created_at: string
          id: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: never
          user_id: string
        }
        Update: {
          created_at?: string
          id?: never
          user_id?: string
        }
        Relationships: []
      }
      app_config: {
        Row: {
          ai_per_hour: number
          claim_per_day: number
          claim_per_hour: number
          id: boolean
          max_photos: number
          page_size: number
          publish_per_day: number
          publish_per_week: number
          updated_at: string
        }
        Insert: {
          ai_per_hour?: number
          claim_per_day?: number
          claim_per_hour?: number
          id?: boolean
          max_photos?: number
          page_size?: number
          publish_per_day?: number
          publish_per_week?: number
          updated_at?: string
        }
        Update: {
          ai_per_hour?: number
          claim_per_day?: number
          claim_per_hour?: number
          id?: boolean
          max_photos?: number
          page_size?: number
          publish_per_day?: number
          publish_per_week?: number
          updated_at?: string
        }
        Relationships: []
      }
      found_item_images: {
        Row: {
          created_at: string
          found_item_id: string
          id: string
          position: number
          storage_path: string
        }
        Insert: {
          created_at?: string
          found_item_id: string
          id?: string
          position?: number
          storage_path: string
        }
        Update: {
          created_at?: string
          found_item_id?: string
          id?: string
          position?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "found_item_images_found_item_id_fkey"
            columns: ["found_item_id"]
            isOneToOne: false
            referencedRelation: "found_items"
            referencedColumns: ["id"]
          },
        ]
      }
      found_items: {
        Row: {
          claimed_at: string | null
          contact: string | null
          created_at: string
          custody: Database["public"]["Enums"]["custody_kind"]
          description: string
          id: string
          location_label: string | null
          location_lat: number | null
          location_lng: number | null
          owner_id: string
          status: Database["public"]["Enums"]["item_status"]
          title: string
          updated_at: string
          withdrawn_at: string | null
        }
        Insert: {
          claimed_at?: string | null
          contact?: string | null
          created_at?: string
          custody: Database["public"]["Enums"]["custody_kind"]
          description: string
          id?: string
          location_label?: string | null
          location_lat?: number | null
          location_lng?: number | null
          owner_id: string
          status?: Database["public"]["Enums"]["item_status"]
          title: string
          updated_at?: string
          withdrawn_at?: string | null
        }
        Update: {
          claimed_at?: string | null
          contact?: string | null
          created_at?: string
          custody?: Database["public"]["Enums"]["custody_kind"]
          description?: string
          id?: string
          location_label?: string | null
          location_lat?: number | null
          location_lng?: number | null
          owner_id?: string
          status?: Database["public"]["Enums"]["item_status"]
          title?: string
          updated_at?: string
          withdrawn_at?: string | null
        }
        Relationships: []
      }
      image_uploads: {
        Row: {
          consumed_at: string | null
          created_at: string
          id: string
          storage_path: string
          uploader_id: string
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          id: string
          storage_path: string
          uploader_id: string
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          id?: string
          storage_path?: string
          uploader_id?: string
        }
        Relationships: []
      }
      pickups: {
        Row: {
          created_at: string
          found_item_id: string
          id: string
          picker_id: string
          picker_name: string
          picker_phone: string
          released_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          found_item_id: string
          id?: string
          picker_id: string
          picker_name: string
          picker_phone: string
          released_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          found_item_id?: string
          id?: string
          picker_id?: string
          picker_name?: string
          picker_phone?: string
          released_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pickups_found_item_id_fkey"
            columns: ["found_item_id"]
            isOneToOne: false
            referencedRelation: "found_items"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          id: string
          phone: string
          real_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          phone: string
          real_name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          phone?: string
          real_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      publish_draft_images: {
        Row: {
          created_at: string
          position: number
          upload_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          position?: number
          upload_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          position?: number
          upload_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "publish_draft_images_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "image_uploads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publish_draft_images_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "publish_drafts"
            referencedColumns: ["user_id"]
          },
        ]
      }
      publish_drafts: {
        Row: {
          contact: string | null
          created_at: string
          custody: Database["public"]["Enums"]["custody_kind"] | null
          description: string
          location_label: string | null
          location_lat: number | null
          location_lng: number | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          contact?: string | null
          created_at?: string
          custody?: Database["public"]["Enums"]["custody_kind"] | null
          description?: string
          location_label?: string | null
          location_lat?: number | null
          location_lng?: number | null
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          contact?: string | null
          created_at?: string
          custody?: Database["public"]["Enums"]["custody_kind"] | null
          description?: string
          location_label?: string | null
          location_lat?: number | null
          location_lng?: number | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      attach_draft_photo: { Args: { p_upload_id: string }; Returns: number }
      consume_ai_quota: {
        Args: Record<PropertyKey, never>
        Returns: {
          out_allowed: boolean
          out_limit: number
          out_used: number
        }[]
      }
      create_pickup: { Args: { p_item_id: string }; Returns: string }
      detach_draft_photo: { Args: { p_upload_id: string }; Returns: string }
      get_app_config: {
        Args: Record<PropertyKey, never>
        Returns: {
          max_photos: number
          page_size: number
        }[]
      }
      list_found_item_claimers: {
        Args: { p_item_id: string }
        Returns: {
          out_created_at: string
          out_picker_id: string
          out_picker_name: string
          out_picker_phone: string
        }[]
      }
      publish_found_item: {
        Args: {
          p_contact?: string
          p_custody: Database["public"]["Enums"]["custody_kind"]
          p_description: string
          p_location_label?: string
          p_location_lat?: number
          p_location_lng?: number
          p_title: string
          p_upload_ids?: string[]
        }
        Returns: string
      }
      release_found_item_claim: {
        Args: { p_item_id: string }
        Returns: Database["public"]["Enums"]["item_status"]
      }
      reveal_found_item_contact: {
        Args: { p_item_id: string }
        Returns: {
          out_contact: string
          out_custody: Database["public"]["Enums"]["custody_kind"]
          out_location_label: string
          out_location_lat: number
          out_location_lng: number
        }[]
      }
      save_publish_draft: {
        Args: {
          p_contact?: string
          p_custody?: Database["public"]["Enums"]["custody_kind"]
          p_description?: string
          p_location_label?: string
          p_location_lat?: number
          p_location_lng?: number
          p_title?: string
        }
        Returns: undefined
      }
      withdraw_found_item: {
        Args: { p_item_id: string }
        Returns: Database["public"]["Enums"]["item_status"]
      }
    }
    Enums: {
      custody_kind: "kept" | "in_place"
      item_status: "published" | "claimed" | "withdrawn"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      custody_kind: ["kept", "in_place"],
      item_status: ["published", "claimed", "withdrawn"],
    },
  },
} as const
